const { ethers, upgrades } = require("hardhat");

async function main() {
    console.log("🚀 Deploying Dead Man's DAO contracts...");
    
    const [deployer] = await ethers.getSigners();
    console.log("Deploying contracts with account:", deployer.address);
    console.log("Account balance:", (await deployer.getBalance()).toString());

    // Deploy GuardianRegistry first
    console.log("\n📋 Deploying GuardianRegistry...");
    const GuardianRegistry = await ethers.getContractFactory("GuardianRegistry");
    const guardianRegistry = await GuardianRegistry.deploy(
        deployer.address, // admin
        ethers.constants.AddressZero // willManager (will update later)
    );
    await guardianRegistry.deployed();
    console.log("GuardianRegistry deployed to:", guardianRegistry.address);

    // Deploy WillManager
    console.log("\n📜 Deploying WillManager...");
    const WillManager = await ethers.getContractFactory("WillManager");
    const willManager = await WillManager.deploy(
        deployer.address, // admin
        deployer.address  // keeper (for now, replace with Chainlink keeper later)
    );
    await willManager.deployed();
    console.log("WillManager deployed to:", willManager.address);

    // Deploy AssetVault
    console.log("\n🏦 Deploying AssetVault...");
    const AssetVault = await ethers.getContractFactory("AssetVault");
    const assetVault = await AssetVault.deploy(
        willManager.address, // willManager
        deployer.address     // admin
    );
    await assetVault.deployed();
    console.log("AssetVault deployed to:", assetVault.address);

    // Update GuardianRegistry with WillManager address
    console.log("\n🔗 Configuring contract relationships...");
    const WILL_MANAGER_ROLE = await guardianRegistry.WILL_MANAGER_ROLE();
    await guardianRegistry.grantRole(WILL_MANAGER_ROLE, willManager.address);
    console.log("✅ WillManager role granted to GuardianRegistry");

    // Verify deployments
    console.log("\n🔍 Verifying deployments...");
    
    // Test GuardianRegistry
    const guardianCount = await guardianRegistry.getGuardianCount();
    console.log("Guardian count:", guardianCount.toString());
    
    // Test WillManager
    const nextWillId = await willManager.nextWillId();
    console.log("Next will ID:", nextWillId.toString());
    
    // Test AssetVault
    const totalEthHeld = await assetVault.totalEthHeld();
    console.log("Total ETH held in vault:", ethers.utils.formatEther(totalEthHeld));

    // Create a sample configuration file
    const config = {
        network: await deployer.provider.getNetwork(),
        deployer: deployer.address,
        contracts: {
            GuardianRegistry: guardianRegistry.address,
            WillManager: willManager.address,
            AssetVault: assetVault.address
        },
        deploymentTime: new Date().toISOString(),
        contractInfo: {
            GuardianRegistry: {
                address: guardianRegistry.address,
                roles: {
                    ADMIN_ROLE: await guardianRegistry.ADMIN_ROLE(),
                    WILL_MANAGER_ROLE: await guardianRegistry.WILL_MANAGER_ROLE()
                }
            },
            WillManager: {
                address: willManager.address,
                roles: {
                    ADMIN_ROLE: await willManager.ADMIN_ROLE(),
                    KEEPER_ROLE: await willManager.KEEPER_ROLE()
                },
                constants: {
                    MAX_GUARDIANS: await willManager.MAX_GUARDIANS(),
                    MAX_BENEFICIARIES: await willManager.MAX_BENEFICIARIES(),
                    MIN_HEARTBEAT_TIMEOUT: await willManager.MIN_HEARTBEAT_TIMEOUT(),
                    RELEASE_TIMELOCK: await willManager.RELEASE_TIMELOCK()
                }
            },
            AssetVault: {
                address: assetVault.address,
                roles: {
                    ADMIN_ROLE: await assetVault.ADMIN_ROLE(),
                    WILL_MANAGER_ROLE: await assetVault.WILL_MANAGER_ROLE()
                }
            }
        }
    };

    // Save configuration
    const fs = require('fs');
    const configPath = './deployment-config.json';
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    console.log(`\n💾 Configuration saved to ${configPath}`);

    console.log("\n🎉 Deployment completed successfully!");
    console.log("\n📋 Contract Summary:");
    console.log("==================");
    console.log(`GuardianRegistry: ${guardianRegistry.address}`);
    console.log(`WillManager:      ${willManager.address}`);
    console.log(`AssetVault:       ${assetVault.address}`);
    
    console.log("\n🔧 Next Steps:");
    console.log("1. Set up Chainlink Automation for the WillManager");
    console.log("2. Register initial guardians in GuardianRegistry");
    console.log("3. Configure minimum reputation and guardian limits");
    console.log("4. Test with a sample will creation");
    
    return {
        guardianRegistry,
        willManager,
        assetVault
    };
}

// Execute deployment
if (require.main === module) {
    main()
        .then(() => process.exit(0))
        .catch((error) => {
            console.error("💥 Deployment failed:");
            console.error(error);
            process.exit(1);
        });
}

module.exports = main;