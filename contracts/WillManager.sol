// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@chainlink/contracts/src/v0.8/AutomationCompatible.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import "../interfaces/IWillManager.sol";

/**
 * @title WillManager
 * @dev Core contract for the Dead Man's DAO - manages digital wills and inheritance
 * @notice This contract handles the creation, management, and execution of blockchain-based wills
 */
contract WillManager is 
    IWillManager,
    AutomationCompatibleInterface,
    AccessControl,
    ReentrancyGuard,
    Pausable
{
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;

    /// @notice Role for automation/keeper services
    bytes32 public constant KEEPER_ROLE = keccak256("KEEPER_ROLE");
    
    /// @notice Role for emergency administration
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");

    /// @notice Maximum number of guardians per will
    uint256 public constant MAX_GUARDIANS = 20;
    
    /// @notice Maximum number of beneficiaries per will
    uint256 public constant MAX_BENEFICIARIES = 50;
    
    /// @notice Minimum heartbeat timeout (1 day)
    uint64 public constant MIN_HEARTBEAT_TIMEOUT = 1 days;
    
    /// @notice Maximum heartbeat timeout (10 years)
    uint64 public constant MAX_HEARTBEAT_TIMEOUT = 10 * 365 days;
    
    /// @notice Timelock delay for releases (7 days)
    uint64 public constant RELEASE_TIMELOCK = 7 days;

    /// @notice Structure representing a digital will
    struct Will {
        address owner;                    // Owner of the will
        address[] beneficiaries;          // List of beneficiaries
        string encryptedCID;              // IPFS/Arweave CID of encrypted payload
        bytes32 payloadHash;              // Hash of encrypted payload for integrity
        uint64 lastHeartbeat;             // Timestamp of last heartbeat
        uint64 heartbeatTimeout;          // Timeout period for heartbeat
        uint64 releaseAfterTimestamp;     // Optional explicit release timestamp
        uint8 guardianThreshold;          // Required guardian approvals
        address[] guardians;              // List of guardians
        uint256 guardianApprovals;        // Bitmap of guardian approvals
        bool releaseRequested;            // Whether release has been requested
        bool released;                    // Whether will has been released
        address vaultAddress;             // Optional custodial vault
        bytes32 commitmentRoot;           // Root hash for off-chain commitments
        uint64 releaseRequestTimestamp;   // When release was requested (for timelock)
    }

    /// @notice Mapping of will ID to Will struct
    mapping(uint256 => Will) public wills;
    
    /// @notice Mapping to track guardian approvals for each will
    mapping(uint256 => mapping(address => bool)) public guardianApprovalStatus;
    
    /// @notice Mapping to track guardian indices for efficient bitmap operations
    mapping(uint256 => mapping(address => uint8)) public guardianIndices;
    
    /// @notice Counter for generating unique will IDs
    uint256 public nextWillId = 1;
    
    /// @notice Queue of wills pending check (for efficient automation)
    uint256[] public pendingChecks;
    
    /// @notice Index in pending checks queue
    uint256 public pendingCheckIndex;

    /**
     * @notice Constructor sets up roles and initial configuration
     * @param admin Address to be granted admin role
     * @param keeper Address to be granted keeper role
     */
    constructor(address admin, address keeper) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(ADMIN_ROLE, admin);
        _grantRole(KEEPER_ROLE, keeper);
    }

    /**
     * @notice Creates a new digital will
     * @dev Validates all parameters and initializes will state
     */
    function createWill(
        address[] calldata guardians,
        uint8 guardianThreshold,
        string calldata encryptedCID,
        bytes32 payloadHash,
        uint64 heartbeatTimeout,
        address[] calldata beneficiaries,
        address vaultAddress
    ) external override nonReentrant returns (uint256 willId) {
        // Validation
        if (guardians.length == 0 || guardians.length > MAX_GUARDIANS) {
            revert InvalidParameters();
        }
        if (beneficiaries.length == 0 || beneficiaries.length > MAX_BENEFICIARIES) {
            revert InvalidParameters();
        }
        if (guardianThreshold == 0 || guardianThreshold > guardians.length) {
            revert InvalidParameters();
        }
        if (heartbeatTimeout < MIN_HEARTBEAT_TIMEOUT || heartbeatTimeout > MAX_HEARTBEAT_TIMEOUT) {
            revert InvalidParameters();
        }
        if (bytes(encryptedCID).length == 0 || payloadHash == bytes32(0)) {
            revert InvalidParameters();
        }

        // Check for duplicate guardians
        for (uint256 i = 0; i < guardians.length; i++) {
            if (guardians[i] == address(0) || guardians[i] == msg.sender) {
                revert InvalidParameters();
            }
            for (uint256 j = i + 1; j < guardians.length; j++) {
                if (guardians[i] == guardians[j]) {
                    revert InvalidParameters();
                }
            }
        }

        // Check for duplicate beneficiaries
        for (uint256 i = 0; i < beneficiaries.length; i++) {
            if (beneficiaries[i] == address(0)) {
                revert InvalidParameters();
            }
            for (uint256 j = i + 1; j < beneficiaries.length; j++) {
                if (beneficiaries[i] == beneficiaries[j]) {
                    revert InvalidParameters();
                }
            }
        }

        willId = nextWillId++;
        
        Will storage will = wills[willId];
        will.owner = msg.sender;
        will.encryptedCID = encryptedCID;
        will.payloadHash = payloadHash;
        will.lastHeartbeat = uint64(block.timestamp);
        will.heartbeatTimeout = heartbeatTimeout;
        will.guardianThreshold = guardianThreshold;
        will.vaultAddress = vaultAddress;
        
        // Store guardians and set up indices
        for (uint256 i = 0; i < guardians.length; i++) {
            will.guardians.push(guardians[i]);
            guardianIndices[willId][guardians[i]] = uint8(i);
        }
        
        // Store beneficiaries
        for (uint256 i = 0; i < beneficiaries.length; i++) {
            will.beneficiaries.push(beneficiaries[i]);
        }
        
        // Add to pending checks queue
        pendingChecks.push(willId);

        emit WillCreated(willId, msg.sender, vaultAddress, encryptedCID);
    }

    /**
     * @notice Owner provides heartbeat to reset the timer
     */
    function heartbeat(uint256 willId) external override {
        Will storage will = wills[willId];
        if (will.owner != msg.sender) revert NotOwner();
        if (will.released) revert AlreadyReleased();
        
        will.lastHeartbeat = uint64(block.timestamp);
        
        emit Heartbeat(willId, uint64(block.timestamp));
    }

    /**
     * @notice Guardian approves will release
     */
    function guardianApprove(uint256 willId) external override {
        Will storage will = wills[willId];
        if (will.released) revert AlreadyReleased();
        
        // Check if caller is a guardian
        bool isGuardian = false;
        uint8 guardianIndex = 0;
        for (uint256 i = 0; i < will.guardians.length; i++) {
            if (will.guardians[i] == msg.sender) {
                isGuardian = true;
                guardianIndex = uint8(i);
                break;
            }
        }
        if (!isGuardian) revert NotGuardian();
        
        // Check if already approved
        if (guardianApprovalStatus[willId][msg.sender]) {
            return; // Already approved, no need to revert
        }
        
        // Set approval
        guardianApprovalStatus[willId][msg.sender] = true;
        will.guardianApprovals |= (1 << guardianIndex);
        
        emit GuardianApproved(willId, msg.sender);
        
        // Check if threshold reached
        uint256 approvalCount = _countApprovals(will.guardianApprovals);
        if (approvalCount >= will.guardianThreshold && !will.releaseRequested) {
            will.releaseRequested = true;
            will.releaseRequestTimestamp = uint64(block.timestamp);
            emit ReleaseRequested(willId, uint64(block.timestamp + RELEASE_TIMELOCK));
        }
    }

    /**
     * @notice Owner voluntarily requests will release
     */
    function requestReleaseByOwner(uint256 willId) external override {
        Will storage will = wills[willId];
        if (will.owner != msg.sender) revert NotOwner();
        if (will.released) revert AlreadyReleased();
        if (will.releaseRequested) return; // Already requested
        
        will.releaseRequested = true;
        will.releaseRequestTimestamp = uint64(block.timestamp);
        
        emit ReleaseRequested(willId, uint64(block.timestamp + RELEASE_TIMELOCK));
    }

    /**
     * @notice Finalizes will release (called by automation after timelock)
     */
    function finalizeRelease(uint256 willId) external override onlyRole(KEEPER_ROLE) {
        Will storage will = wills[willId];
        if (will.released) revert AlreadyReleased();
        if (!will.releaseRequested) revert InvalidParameters();
        
        // Check timelock
        if (block.timestamp < will.releaseRequestTimestamp + RELEASE_TIMELOCK) {
            revert TimelockNotExpired();
        }
        
        will.released = true;
        
        // If custodial vault, trigger asset transfer
        if (will.vaultAddress != address(0)) {
            // Call vault to transfer assets to beneficiaries
            // This would integrate with AssetVault contract
            // IAssetVault(will.vaultAddress).releaseAssets(will.beneficiaries);
        }
        
        emit ReleaseFinalized(willId, will.beneficiaries);
    }

    /**
     * @notice Chainlink Automation compatibility - checks if upkeep is needed
     */
    function checkUpkeep(
        bytes calldata /* checkData */
    ) external view override returns (bool upkeepNeeded, bytes memory performData) {
        uint256[] memory eligibleWills = new uint256[](pendingChecks.length);
        uint256 count = 0;
        
        // Check a batch of wills from the queue
        uint256 startIndex = pendingCheckIndex;
        uint256 batchSize = 10; // Process up to 10 wills per check
        
        for (uint256 i = 0; i < batchSize && (startIndex + i) < pendingChecks.length; i++) {
            uint256 willId = pendingChecks[startIndex + i];
            Will memory will = wills[willId];
            
            if (_isEligibleForRelease(will) && !will.released) {
                eligibleWills[count] = willId;
                count++;
            }
        }
        
        if (count > 0) {
            upkeepNeeded = true;
            // Encode the eligible will IDs
            uint256[] memory result = new uint256[](count);
            for (uint256 i = 0; i < count; i++) {
                result[i] = eligibleWills[i];
            }
            performData = abi.encode(result);
        }
    }

    /**
     * @notice Chainlink Automation compatibility - performs upkeep
     */
    function performUpkeep(bytes calldata performData) external override onlyRole(KEEPER_ROLE) {
        uint256[] memory willIds = abi.decode(performData, (uint256[]));
        
        for (uint256 i = 0; i < willIds.length; i++) {
            uint256 willId = willIds[i];
            Will storage will = wills[willId];
            
            // Double-check eligibility and handle release
            if (_isEligibleForRelease(will) && !will.released && !will.releaseRequested) {
                // Check if heartbeat expired and sufficient guardian approvals
                bool heartbeatExpired = block.timestamp >= will.lastHeartbeat + will.heartbeatTimeout;
                uint256 approvalCount = _countApprovals(will.guardianApprovals);
                bool sufficientApprovals = approvalCount >= will.guardianThreshold;
                
                if (heartbeatExpired && sufficientApprovals) {
                    will.releaseRequested = true;
                    will.releaseRequestTimestamp = uint64(block.timestamp);
                    emit ReleaseRequested(willId, uint64(block.timestamp + RELEASE_TIMELOCK));
                }
            }
        }
        
        // Update pending check index
        pendingCheckIndex = (pendingCheckIndex + 10) % pendingChecks.length;
    }

    /**
     * @notice Gets complete will information
     */
    function getWill(uint256 willId) external view override returns (
        address owner,
        address[] memory beneficiaries,
        string memory encryptedCID,
        bytes32 payloadHash,
        uint64 lastHeartbeat,
        uint64 heartbeatTimeout,
        uint8 guardianThreshold,
        address[] memory guardians,
        bool releaseRequested,
        bool released,
        address vaultAddress
    ) {
        Will memory will = wills[willId];
        if (will.owner == address(0)) revert WillNotFound();
        
        return (
            will.owner,
            will.beneficiaries,
            will.encryptedCID,
            will.payloadHash,
            will.lastHeartbeat,
            will.heartbeatTimeout,
            will.guardianThreshold,
            will.guardians,
            will.releaseRequested,
            will.released,
            will.vaultAddress
        );
    }

    /**
     * @notice Checks if will is eligible for release
     */
    function isEligibleForRelease(uint256 willId) external view override returns (bool eligible) {
        Will memory will = wills[willId];
        return _isEligibleForRelease(will);
    }

    /**
     * @notice Gets guardian approval status
     */
    function getGuardianApprovals(uint256 willId) external view override returns (
        uint256 approvals,
        uint256 required
    ) {
        Will memory will = wills[willId];
        return (_countApprovals(will.guardianApprovals), will.guardianThreshold);
    }

    // Placeholder functions for TSS integration (to be implemented)
    function submitThresholdSignature(
        uint256 willId,
        bytes calldata signature,
        bytes calldata sigMeta
    ) external override {
        // TODO: Implement TSS signature submission
        emit TssSignatureSubmitted(willId, signature);
    }

    function verifySignatureAndExecute(
        uint256 willId,
        bytes calldata signature
    ) external override {
        // TODO: Implement TSS signature verification and execution
    }

    function migrateWill(
        uint256 willId,
        address newManager,
        bytes calldata signature
    ) external override {
        // TODO: Implement will migration with multi-sig verification
        emit WillMigrated(willId, newManager);
    }

    /**
     * @notice Internal function to check if will is eligible for release
     */
    function _isEligibleForRelease(Will memory will) internal view returns (bool) {
        if (will.released || will.owner == address(0)) return false;
        
        bool heartbeatExpired = block.timestamp >= will.lastHeartbeat + will.heartbeatTimeout;
        uint256 approvalCount = _countApprovals(will.guardianApprovals);
        bool sufficientApprovals = approvalCount >= will.guardianThreshold;
        
        return heartbeatExpired && sufficientApprovals;
    }

    /**
     * @notice Internal function to count set bits in approval bitmap
     */
    function _countApprovals(uint256 approvals) internal pure returns (uint256 count) {
        while (approvals != 0) {
            count++;
            approvals &= approvals - 1; // Clear the lowest set bit
        }
    }

    /**
     * @notice Emergency pause function
     */
    function pause() external onlyRole(ADMIN_ROLE) {
        _pause();
    }

    /**
     * @notice Emergency unpause function
     */
    function unpause() external onlyRole(ADMIN_ROLE) {
        _unpause();
    }
}