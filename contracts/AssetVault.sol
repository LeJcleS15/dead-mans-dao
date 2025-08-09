// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/token/ERC721/utils/ERC721Holder.sol";
import "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";
import "@openzeppelin/contracts/token/ERC1155/utils/ERC1155Holder.sol";
import "@openzeppelin/contracts/utils/Address.sol";

/**
 * @title AssetVault
 * @dev Custodial vault for holding digital assets until will release conditions are met
 * @notice This contract securely holds ETH, ERC20, ERC721, and ERC1155 assets for digital wills
 */
contract AssetVault is 
    ReentrancyGuard, 
    Pausable, 
    AccessControl, 
    ERC721Holder, 
    ERC1155Holder 
{
    using Address for address payable;

    /// @notice Role for the will manager contract
    bytes32 public constant WILL_MANAGER_ROLE = keccak256("WILL_MANAGER_ROLE");
    
    /// @notice Role for emergency administration
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");

    /// @notice Structure for tracking deposited assets
    struct AssetDeposit {
        address token;        // Token contract address (address(0) for ETH)
        uint256 amount;       // Amount/tokenId
        uint256 tokenType;    // 0=ETH, 1=ERC20, 2=ERC721, 3=ERC1155
        bool released;        // Whether asset has been released
    }

    /// @notice Mapping of will ID to depositor
    mapping(uint256 => address) public willDepositors;
    
    /// @notice Mapping of will ID to list of assets
    mapping(uint256 => AssetDeposit[]) public willAssets;
    
    /// @notice Mapping to track total ETH per will
    mapping(uint256 => uint256) public willEthBalances;
    
    /// @notice Total ETH held in vault
    uint256 public totalEthHeld;

    /// @notice Events
    event AssetDeposited(
        uint256 indexed willId,
        address indexed depositor,
        address token,
        uint256 amount,
        uint256 tokenType
    );
    
    event AssetReleased(
        uint256 indexed willId,
        address indexed beneficiary,
        address token,
        uint256 amount,
        uint256 tokenType
    );
    
    event EmergencyWithdrawal(
        uint256 indexed willId,
        address indexed owner,
        address token,
        uint256 amount
    );

    /// @notice Custom errors
    error UnauthorizedCaller();
    error AssetAlreadyReleased();
    error InsufficientBalance();
    error InvalidTokenType();
    error TransferFailed();
    error WillNotFound();
    error NotOwner();

    /**
     * @notice Constructor sets up roles
     * @param willManager Address of the WillManager contract
     * @param admin Address to be granted admin role
     */
    constructor(address willManager, address admin) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(ADMIN_ROLE, admin);
        _grantRole(WILL_MANAGER_ROLE, willManager);
    }

    /**
     * @notice Deposits ETH for a specific will
     * @param willId The will identifier
     */
    function depositEth(uint256 willId) external payable whenNotPaused {
        require(msg.value > 0, "No ETH sent");
        
        willDepositors[willId] = msg.sender;
        willEthBalances[willId] += msg.value;
        totalEthHeld += msg.value;
        
        willAssets[willId].push(AssetDeposit({
            token: address(0),
            amount: msg.value,
            tokenType: 0,
            released: false
        }));
        
        emit AssetDeposited(willId, msg.sender, address(0), msg.value, 0);
    }

    /**
     * @notice Deposits ERC20 tokens for a specific will
     * @param willId The will identifier
     * @param token ERC20 token contract address
     * @param amount Amount of tokens to deposit
     */
    function depositERC20(
        uint256 willId,
        address token,
        uint256 amount
    ) external whenNotPaused nonReentrant {
        require(token != address(0), "Invalid token address");
        require(amount > 0, "Amount must be positive");
        
        // Transfer tokens from sender to this contract
        IERC20(token).transferFrom(msg.sender, address(this), amount);
        
        willDepositors[willId] = msg.sender;
        
        willAssets[willId].push(AssetDeposit({
            token: token,
            amount: amount,
            tokenType: 1,
            released: false
        }));
        
        emit AssetDeposited(willId, msg.sender, token, amount, 1);
    }

    /**
     * @notice Deposits ERC721 NFT for a specific will
     * @param willId The will identifier
     * @param token ERC721 token contract address
     * @param tokenId NFT token ID
     */
    function depositERC721(
        uint256 willId,
        address token,
        uint256 tokenId
    ) external whenNotPaused nonReentrant {
        require(token != address(0), "Invalid token address");
        
        // Transfer NFT from sender to this contract
        IERC721(token).safeTransferFrom(msg.sender, address(this), tokenId);
        
        willDepositors[willId] = msg.sender;
        
        willAssets[willId].push(AssetDeposit({
            token: token,
            amount: tokenId,
            tokenType: 2,
            released: false
        }));
        
        emit AssetDeposited(willId, msg.sender, token, tokenId, 2);
    }

    /**
     * @notice Deposits ERC1155 tokens for a specific will
     * @param willId The will identifier
     * @param token ERC1155 token contract address
     * @param tokenId Token ID
     * @param amount Amount of tokens
     */
    function depositERC1155(
        uint256 willId,
        address token,
        uint256 tokenId,
        uint256 amount
    ) external whenNotPaused nonReentrant {
        require(token != address(0), "Invalid token address");
        require(amount > 0, "Amount must be positive");
        
        // Transfer tokens from sender to this contract
        IERC1155(token).safeTransferFrom(
            msg.sender,
            address(this),
            tokenId,
            amount,
            ""
        );
        
        willDepositors[willId] = msg.sender;
        
        willAssets[willId].push(AssetDeposit({
            token: token,
            amount: amount,
            tokenType: 3,
            released: false
        }));
        
        emit AssetDeposited(willId, msg.sender, token, amount, 3);
    }

    /**
     * @notice Releases all assets for a will to beneficiaries
     * @dev Only callable by WillManager contract after release conditions are met
     * @param willId The will identifier
     * @param beneficiaries Array of beneficiary addresses
     * @param percentages Array of percentage allocations (basis points, total = 10000)
     */
    function releaseAssets(
        uint256 willId,
        address[] calldata beneficiaries,
        uint256[] calldata percentages
    ) external onlyRole(WILL_MANAGER_ROLE) whenNotPaused nonReentrant {
        require(beneficiaries.length == percentages.length, "Array length mismatch");
        require(beneficiaries.length > 0, "No beneficiaries");
        
        // Validate percentages sum to 100%
        uint256 totalPercentage = 0;
        for (uint256 i = 0; i < percentages.length; i++) {
            totalPercentage += percentages[i];
        }
        require(totalPercentage == 10000, "Percentages must sum to 100%");
        
        AssetDeposit[] storage assets = willAssets[willId];
        
        for (uint256 i = 0; i < assets.length; i++) {
            AssetDeposit storage asset = assets[i];
            
            if (asset.released) continue;
            
            asset.released = true;
            
            // Distribute asset among beneficiaries
            if (asset.tokenType == 0) {
                // ETH distribution
                _distributeEth(willId, asset.amount, beneficiaries, percentages);
            } else if (asset.tokenType == 1) {
                // ERC20 distribution
                _distributeERC20(asset.token, asset.amount, beneficiaries, percentages);
            } else if (asset.tokenType == 2) {
                // ERC721 - give to first beneficiary (indivisible)
                _transferERC721(asset.token, asset.amount, beneficiaries[0]);
                emit AssetReleased(willId, beneficiaries[0], asset.token, asset.amount, 2);
            } else if (asset.tokenType == 3) {
                // ERC1155 distribution
                _distributeERC1155(asset.token, asset.amount, beneficiaries, percentages);
            }
        }
    }

    /**
     * @notice Emergency withdrawal by original depositor (before release)
     * @param willId The will identifier
     * @param assetIndex Index of asset to withdraw
     */
    function emergencyWithdraw(
        uint256 willId,
        uint256 assetIndex
    ) external nonReentrant {
        require(willDepositors[willId] == msg.sender, "Not the depositor");
        
        AssetDeposit[] storage assets = willAssets[willId];
        require(assetIndex < assets.length, "Invalid asset index");
        
        AssetDeposit storage asset = assets[assetIndex];
        require(!asset.released, "Asset already released");
        
        asset.released = true;
        
        if (asset.tokenType == 0) {
            // ETH
            willEthBalances[willId] -= asset.amount;
            totalEthHeld -= asset.amount;
            payable(msg.sender).sendValue(asset.amount);
        } else if (asset.tokenType == 1) {
            // ERC20
            IERC20(asset.token).transfer(msg.sender, asset.amount);
        } else if (asset.tokenType == 2) {
            // ERC721
            IERC721(asset.token).safeTransferFrom(address(this), msg.sender, asset.amount);
        } else if (asset.tokenType == 3) {
            // ERC1155
            IERC1155(asset.token).safeTransferFrom(
                address(this),
                msg.sender,
                asset.amount, // tokenId
                1, // amount (stored in different field for ERC1155)
                ""
            );
        }
        
        emit EmergencyWithdrawal(willId, msg.sender, asset.token, asset.amount);
    }

    /**
     * @notice Gets all assets for a will
     * @param willId The will identifier
     * @return assets Array of AssetDeposit structs
     */
    function getWillAssets(uint256 willId) external view returns (AssetDeposit[] memory assets) {
        return willAssets[willId];
    }

    /**
     * @notice Gets asset count for a will
     * @param willId The will identifier
     * @return count Number of assets deposited
     */
    function getAssetCount(uint256 willId) external view returns (uint256 count) {
        return willAssets[willId].length;
    }

    /**
     * @notice Internal function to distribute ETH among beneficiaries
     */
    function _distributeEth(
        uint256 willId,
        uint256 totalAmount,
        address[] calldata beneficiaries,
        uint256[] calldata percentages
    ) internal {
        willEthBalances[willId] -= totalAmount;
        totalEthHeld -= totalAmount;
        
        for (uint256 i = 0; i < beneficiaries.length; i++) {
            uint256 amount = (totalAmount * percentages[i]) / 10000;
            if (amount > 0) {
                payable(beneficiaries[i]).sendValue(amount);
                emit AssetReleased(willId, beneficiaries[i], address(0), amount, 0);
            }
        }
    }

    /**
     * @notice Internal function to distribute ERC20 tokens among beneficiaries
     */
    function _distributeERC20(
        address token,
        uint256 totalAmount,
        address[] calldata beneficiaries,
        uint256[] calldata percentages
    ) internal {
        for (uint256 i = 0; i < beneficiaries.length; i++) {
            uint256 amount = (totalAmount * percentages[i]) / 10000;
            if (amount > 0) {
                IERC20(token).transfer(beneficiaries[i], amount);
                emit AssetReleased(0, beneficiaries[i], token, amount, 1);
            }
        }
    }

    /**
     * @notice Internal function to transfer ERC721 NFT
     */
    function _transferERC721(
        address token,
        uint256 tokenId,
        address beneficiary
    ) internal {
        IERC721(token).safeTransferFrom(address(this), beneficiary, tokenId);
    }

    /**
     * @notice Internal function to distribute ERC1155 tokens among beneficiaries
     */
    function _distributeERC1155(
        address token,
        uint256 amount,
        address[] calldata beneficiaries,
        uint256[] calldata percentages
    ) internal {
        // Note: For ERC1155, amount is stored as tokenId, actual amount needs to be tracked separately
        // This is a simplified implementation
        for (uint256 i = 0; i < beneficiaries.length; i++) {
            uint256 share = (amount * percentages[i]) / 10000;
            if (share > 0) {
                IERC1155(token).safeTransferFrom(
                    address(this),
                    beneficiaries[i],
                    amount, // tokenId
                    share,
                    ""
                );
                emit AssetReleased(0, beneficiaries[i], token, share, 3);
            }
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

    /**
     * @notice Fallback function to receive ETH
     */
    receive() external payable {
        // ETH received directly (not recommended, use depositEth instead)
    }
}