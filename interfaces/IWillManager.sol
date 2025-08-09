// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/**
 * @title IWillManager
 * @dev Interface for the Dead Man's DAO Will Management system
 * @notice This interface defines the core functionality for creating, managing, and executing digital wills
 */
interface IWillManager {
    /// @notice Emitted when a new will is created
    event WillCreated(
        uint256 indexed willId,
        address indexed owner,
        address vaultAddress,
        string encryptedCID
    );

    /// @notice Emitted when owner provides a heartbeat
    event Heartbeat(uint256 indexed willId, uint64 timestamp);

    /// @notice Emitted when a guardian approves a will release
    event GuardianApproved(uint256 indexed willId, address indexed guardian);

    /// @notice Emitted when a will release is requested
    event ReleaseRequested(uint256 indexed willId, uint64 releaseTimestamp);

    /// @notice Emitted when a will is finally released
    event ReleaseFinalized(uint256 indexed willId, address[] beneficiaries);

    /// @notice Emitted when a will is migrated to a new contract
    event WillMigrated(uint256 indexed willId, address newContract);

    /// @notice Emitted when a TSS signature is submitted
    event TssSignatureSubmitted(uint256 indexed willId, bytes signature);

    /// @notice Custom errors for gas efficiency
    error NotOwner();
    error NotGuardian();
    error AlreadyReleased();
    error ThresholdNotMet();
    error NotUpkeep();
    error InvalidParameters();
    error WillNotFound();
    error HeartbeatNotExpired();
    error TimelockNotExpired();
    error UnauthorizedAccess();

    /**
     * @notice Creates a new will with specified parameters
     * @param guardians Array of guardian addresses
     * @param guardianThreshold Minimum number of guardian approvals needed
     * @param encryptedCID IPFS/Arweave CID of encrypted payload
     * @param payloadHash Hash of the encrypted payload for integrity
     * @param heartbeatTimeout Time in seconds before will becomes eligible for release
     * @param beneficiaries Array of beneficiary addresses
     * @param vaultAddress Optional custodial vault address (0 for non-custodial)
     * @return willId The unique identifier for the created will
     */
    function createWill(
        address[] calldata guardians,
        uint8 guardianThreshold,
        string calldata encryptedCID,
        bytes32 payloadHash,
        uint64 heartbeatTimeout,
        address[] calldata beneficiaries,
        address vaultAddress
    ) external returns (uint256 willId);

    /**
     * @notice Owner provides heartbeat to reset timer
     * @param willId The will identifier
     */
    function heartbeat(uint256 willId) external;

    /**
     * @notice Guardian approves will release
     * @param willId The will identifier
     */
    function guardianApprove(uint256 willId) external;

    /**
     * @notice Owner voluntarily requests will release
     * @param willId The will identifier
     */
    function requestReleaseByOwner(uint256 willId) external;

    /**
     * @notice Finalizes will release (called by automation/timelock)
     * @param willId The will identifier
     */
    function finalizeRelease(uint256 willId) external;

    /**
     * @notice Migrates will to new contract (requires multi-sig)
     * @param willId The will identifier
     * @param newManager Address of new will manager contract
     * @param signature Multi-sig signature authorizing migration
     */
    function migrateWill(
        uint256 willId,
        address newManager,
        bytes calldata signature
    ) external;

    /**
     * @notice Submits threshold signature for TSS-based release
     * @param willId The will identifier
     * @param signature The threshold signature
     * @param sigMeta Additional signature metadata
     */
    function submitThresholdSignature(
        uint256 willId,
        bytes calldata signature,
        bytes calldata sigMeta
    ) external;

    /**
     * @notice Verifies signature and executes release
     * @param willId The will identifier
     * @param signature The signature to verify
     */
    function verifySignatureAndExecute(
        uint256 willId,
        bytes calldata signature
    ) external;

    /**
     * @notice Gets will information
     * @param willId The will identifier
     * @return Will struct containing all will data
     */
    function getWill(uint256 willId) external view returns (
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
    );

    /**
     * @notice Checks if will is eligible for release
     * @param willId The will identifier
     * @return eligible True if will meets release conditions
     */
    function isEligibleForRelease(uint256 willId) external view returns (bool eligible);

    /**
     * @notice Gets guardian approval status for a will
     * @param willId The will identifier
     * @return approvals Number of current approvals
     * @return required Number of required approvals
     */
    function getGuardianApprovals(uint256 willId) external view returns (
        uint256 approvals,
        uint256 required
    );
}