// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/**
 * @title GuardianRegistry
 * @dev Registry for managing guardians and their commitments for the Dead Man's DAO
 * @notice This contract handles guardian registration, key commitments, and reputation tracking
 */
contract GuardianRegistry is AccessControl, ReentrancyGuard {
    using ECDSA for bytes32;

    /// @notice Role for will manager contract
    bytes32 public constant WILL_MANAGER_ROLE = keccak256("WILL_MANAGER_ROLE");
    
    /// @notice Role for administrators
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");

    /// @notice Guardian profile information
    struct GuardianProfile {
        bool isActive;              // Whether guardian is active
        bool isVerified;            // Whether guardian is verified by admin
        string metadataURI;         // IPFS URI for guardian metadata
        bytes32 publicKeyHash;      // Hash of guardian's public key
        uint256 reputation;         // Reputation score (0-1000)
        uint256 totalWills;         // Number of wills guardian participates in
        uint256 successfulReleases; // Number of successful will releases
        uint256 registrationTime;   // When guardian registered
        bytes32 commitmentRoot;     // Merkle root of off-chain commitments
        mapping(bytes32 => bool) commitments; // Individual commitments
    }

    /// @notice Mapping of guardian address to profile
    mapping(address => GuardianProfile) public guardians;
    
    /// @notice Array of all registered guardians
    address[] public registeredGuardians;
    
    /// @notice Mapping to check if address is registered
    mapping(address => bool) public isRegistered;
    
    /// @notice Minimum reputation required for new wills
    uint256 public minReputation = 100;
    
    /// @notice Maximum number of active wills per guardian
    uint256 public maxWillsPerGuardian = 100;

    /// @notice Events
    event GuardianRegistered(address indexed guardian, string metadataURI);
    event GuardianVerified(address indexed guardian, bool verified);
    event GuardianDeactivated(address indexed guardian);
    event CommitmentAdded(address indexed guardian, bytes32 commitment);
    event ReputationUpdated(address indexed guardian, uint256 newReputation);
    event GuardianMetadataUpdated(address indexed guardian, string newMetadataURI);

    /// @notice Custom errors
    error GuardianNotFound();
    error GuardianAlreadyRegistered();
    error GuardianNotActive();
    error InsufficientReputation();
    error MaxWillsExceeded();
    error InvalidCommitment();
    error NotVerified();

    /**
     * @notice Constructor sets up roles
     * @param admin Address to be granted admin role
     * @param willManager Address of WillManager contract
     */
    constructor(address admin, address willManager) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(ADMIN_ROLE, admin);
        _grantRole(WILL_MANAGER_ROLE, willManager);
    }

    /**
     * @notice Registers a new guardian
     * @param metadataURI IPFS URI containing guardian information
     * @param publicKeyHash Hash of guardian's public key
     * @param commitmentRoot Merkle root of initial commitments
     */
    function registerGuardian(
        string calldata metadataURI,
        bytes32 publicKeyHash,
        bytes32 commitmentRoot
    ) external {
        if (isRegistered[msg.sender]) revert GuardianAlreadyRegistered();
        
        GuardianProfile storage guardian = guardians[msg.sender];
        guardian.isActive = true;
        guardian.isVerified = false; // Requires admin verification
        guardian.metadataURI = metadataURI;
        guardian.publicKeyHash = publicKeyHash;
        guardian.reputation = 100; // Starting reputation
        guardian.registrationTime = block.timestamp;
        guardian.commitmentRoot = commitmentRoot;
        
        registeredGuardians.push(msg.sender);
        isRegistered[msg.sender] = true;
        
        emit GuardianRegistered(msg.sender, metadataURI);
    }

    /**
     * @notice Admin verifies a guardian
     * @param guardian Guardian address to verify
     * @param verified Whether to verify or unverify
     */
    function verifyGuardian(
        address guardian,
        bool verified
    ) external onlyRole(ADMIN_ROLE) {
        if (!isRegistered[guardian]) revert GuardianNotFound();
        
        guardians[guardian].isVerified = verified;
        emit GuardianVerified(guardian, verified);
    }

    /**
     * @notice Deactivates a guardian (self or admin)
     * @param guardian Guardian address to deactivate
     */
    function deactivateGuardian(address guardian) external {
        if (msg.sender != guardian && !hasRole(ADMIN_ROLE, msg.sender)) {
            revert UnauthorizedAccess();
        }
        if (!isRegistered[guardian]) revert GuardianNotFound();
        
        guardians[guardian].isActive = false;
        emit GuardianDeactivated(guardian);
    }

    /**
     * @notice Adds a commitment for a guardian
     * @param commitment Hash of the commitment
     */
    function addCommitment(bytes32 commitment) external {
        if (!isRegistered[msg.sender]) revert GuardianNotFound();
        if (!guardians[msg.sender].isActive) revert GuardianNotActive();
        
        guardians[msg.sender].commitments[commitment] = true;
        emit CommitmentAdded(msg.sender, commitment);
    }

    /**
     * @notice Updates guardian metadata
     * @param metadataURI New metadata URI
     */
    function updateMetadata(string calldata metadataURI) external {
        if (!isRegistered[msg.sender]) revert GuardianNotFound();
        
        guardians[msg.sender].metadataURI = metadataURI;
        emit GuardianMetadataUpdated(msg.sender, metadataURI);
    }

    /**
     * @notice Will manager adds guardian to a will (increments count)
     * @param guardian Guardian address
     */
    function addGuardianToWill(address guardian) external onlyRole(WILL_MANAGER_ROLE) {
        if (!isRegistered[guardian]) revert GuardianNotFound();
        if (!guardians[guardian].isActive) revert GuardianNotActive();
        if (!guardians[guardian].isVerified) revert NotVerified();
        if (guardians[guardian].reputation < minReputation) revert InsufficientReputation();
        if (guardians[guardian].totalWills >= maxWillsPerGuardian) revert MaxWillsExceeded();
        
        guardians[guardian].totalWills++;
    }

    /**
     * @notice Will manager removes guardian from a will (decrements count)
     * @param guardian Guardian address
     */
    function removeGuardianFromWill(address guardian) external onlyRole(WILL_MANAGER_ROLE) {
        if (!isRegistered[guardian]) revert GuardianNotFound();
        if (guardians[guardian].totalWills > 0) {
            guardians[guardian].totalWills--;
        }
    }

    /**
     * @notice Will manager records successful release
     * @param guardian Guardian address
     */
    function recordSuccessfulRelease(address guardian) external onlyRole(WILL_MANAGER_ROLE) {
        if (!isRegistered[guardian]) revert GuardianNotFound();
        
        guardians[guardian].successfulReleases++;
        
        // Increase reputation for successful releases
        uint256 currentRep = guardians[guardian].reputation;
        uint256 increase = 10; // Increase by 10 points per successful release
        guardians[guardian].reputation = currentRep + increase > 1000 ? 1000 : currentRep + increase;
        
        emit ReputationUpdated(guardian, guardians[guardian].reputation);
    }

    /**
     * @notice Admin adjusts guardian reputation
     * @param guardian Guardian address
     * @param newReputation New reputation score (0-1000)
     */
    function adjustReputation(
        address guardian,
        uint256 newReputation
    ) external onlyRole(ADMIN_ROLE) {
        if (!isRegistered[guardian]) revert GuardianNotFound();
        require(newReputation <= 1000, "Reputation cannot exceed 1000");
        
        guardians[guardian].reputation = newReputation;
        emit ReputationUpdated(guardian, newReputation);
    }

    /**
     * @notice Gets guardian profile information
     * @param guardian Guardian address
     * @return profile Guardian profile data
     */
    function getGuardianProfile(address guardian) external view returns (
        bool isActive,
        bool isVerified,
        string memory metadataURI,
        bytes32 publicKeyHash,
        uint256 reputation,
        uint256 totalWills,
        uint256 successfulReleases,
        uint256 registrationTime,
        bytes32 commitmentRoot
    ) {
        if (!isRegistered[guardian]) revert GuardianNotFound();
        
        GuardianProfile storage profile = guardians[guardian];
        return (
            profile.isActive,
            profile.isVerified,
            profile.metadataURI,
            profile.publicKeyHash,
            profile.reputation,
            profile.totalWills,
            profile.successfulReleases,
            profile.registrationTime,
            profile.commitmentRoot
        );
    }

    /**
     * @notice Checks if guardian has a specific commitment
     * @param guardian Guardian address
     * @param commitment Commitment hash
     * @return exists Whether commitment exists
     */
    function hasCommitment(
        address guardian,
        bytes32 commitment
    ) external view returns (bool exists) {
        return guardians[guardian].commitments[commitment];
    }

    /**
     * @notice Gets list of verified guardians with minimum reputation
     * @param minRep Minimum reputation required
     * @return qualifiedGuardians Array of qualified guardian addresses
     */
    function getQualifiedGuardians(
        uint256 minRep
    ) external view returns (address[] memory qualifiedGuardians) {
        uint256 count = 0;
        
        // Count qualified guardians
        for (uint256 i = 0; i < registeredGuardians.length; i++) {
            address guardian = registeredGuardians[i];
            GuardianProfile storage profile = guardians[guardian];
            if (profile.isActive && 
                profile.isVerified && 
                profile.reputation >= minRep &&
                profile.totalWills < maxWillsPerGuardian) {
                count++;
            }
        }
        
        // Create result array
        qualifiedGuardians = new address[](count);
        uint256 index = 0;
        
        for (uint256 i = 0; i < registeredGuardians.length; i++) {
            address guardian = registeredGuardians[i];
            GuardianProfile storage profile = guardians[guardian];
            if (profile.isActive && 
                profile.isVerified && 
                profile.reputation >= minRep &&
                profile.totalWills < maxWillsPerGuardian) {
                qualifiedGuardians[index] = guardian;
                index++;
            }
        }
    }

    /**
     * @notice Gets total number of registered guardians
     * @return count Total count
     */
    function getGuardianCount() external view returns (uint256 count) {
        return registeredGuardians.length;
    }

    /**
     * @notice Checks if address is eligible to be a guardian
     * @param guardian Guardian address to check
     * @return eligible Whether guardian is eligible
     */
    function isEligibleGuardian(address guardian) external view returns (bool eligible) {
        if (!isRegistered[guardian]) return false;
        
        GuardianProfile storage profile = guardians[guardian];
        return profile.isActive && 
               profile.isVerified && 
               profile.reputation >= minReputation &&
               profile.totalWills < maxWillsPerGuardian;
    }

    /**
     * @notice Admin sets minimum reputation requirement
     * @param newMinReputation New minimum reputation
     */
    function setMinReputation(uint256 newMinReputation) external onlyRole(ADMIN_ROLE) {
        require(newMinReputation <= 1000, "Min reputation cannot exceed 1000");
        minReputation = newMinReputation;
    }

    /**
     * @notice Admin sets maximum wills per guardian
     * @param newMaxWills New maximum wills per guardian
     */
    function setMaxWillsPerGuardian(uint256 newMaxWills) external onlyRole(ADMIN_ROLE) {
        maxWillsPerGuardian = newMaxWills;
    }

    /// @notice Custom error for unauthorized access
    error UnauthorizedAccess();
}