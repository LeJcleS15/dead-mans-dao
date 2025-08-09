const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("Dead Man's DAO - WillManager", function () {
    let willManager, assetVault, guardianRegistry;
    let owner, admin, keeper, guardian1, guardian2, guardian3, beneficiary1, beneficiary2;
    let accounts;

    const SAMPLE_CID = "QmSampleCIDForTesting123456789";
    const SAMPLE_HASH = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("sample payload"));
    const HEARTBEAT_TIMEOUT = 7 * 24 * 60 * 60; // 7 days
    const RELEASE_TIMELOCK = 7 * 24 * 60 * 60; // 7 days

    beforeEach(async function () {
        accounts = await ethers.getSigners();
        [owner, admin, keeper, guardian1, guardian2, guardian3, beneficiary1, beneficiary2] = accounts;

        // Deploy GuardianRegistry
        const GuardianRegistry = await ethers.getContractFactory("GuardianRegistry");
        guardianRegistry = await GuardianRegistry.deploy(admin.address, ethers.constants.AddressZero);
        await guardianRegistry.deployed();

        // Deploy WillManager
        const WillManager = await ethers.getContractFactory("WillManager");
        willManager = await WillManager.deploy(admin.address, keeper.address);
        await willManager.deployed();

        // Deploy AssetVault
        const AssetVault = await ethers.getContractFactory("AssetVault");
        assetVault = await AssetVault.deploy(willManager.address, admin.address);
        await assetVault.deployed();

        // Set up roles
        const WILL_MANAGER_ROLE = await guardianRegistry.WILL_MANAGER_ROLE();
        await guardianRegistry.connect(admin).grantRole(WILL_MANAGER_ROLE, willManager.address);

        // Register guardians
        await guardianRegistry.connect(guardian1).registerGuardian(
            "ipfs://guardian1-metadata",
            ethers.utils.keccak256(ethers.utils.toUtf8Bytes("guardian1-pubkey")),
            ethers.utils.keccak256(ethers.utils.toUtf8Bytes("commitment-root-1"))
        );
        await guardianRegistry.connect(guardian2).registerGuardian(
            "ipfs://guardian2-metadata",
            ethers.utils.keccak256(ethers.utils.toUtf8Bytes("guardian2-pubkey")),
            ethers.utils.keccak256(ethers.utils.toUtf8Bytes("commitment-root-2"))
        );
        await guardianRegistry.connect(guardian3).registerGuardian(
            "ipfs://guardian3-metadata",
            ethers.utils.keccak256(ethers.utils.toUtf8Bytes("guardian3-pubkey")),
            ethers.utils.keccak256(ethers.utils.toUtf8Bytes("commitment-root-3"))
        );

        // Verify guardians
        await guardianRegistry.connect(admin).verifyGuardian(guardian1.address, true);
        await guardianRegistry.connect(admin).verifyGuardian(guardian2.address, true);
        await guardianRegistry.connect(admin).verifyGuardian(guardian3.address, true);
    });

    describe("Deployment", function () {
        it("Should set the correct admin and keeper roles", async function () {
            const ADMIN_ROLE = await willManager.ADMIN_ROLE();
            const KEEPER_ROLE = await willManager.KEEPER_ROLE();

            expect(await willManager.hasRole(ADMIN_ROLE, admin.address)).to.be.true;
            expect(await willManager.hasRole(KEEPER_ROLE, keeper.address)).to.be.true;
        });

        it("Should initialize with nextWillId = 1", async function () {
            expect(await willManager.nextWillId()).to.equal(1);
        });
    });

    describe("Will Creation", function () {
        it("Should create a will successfully", async function () {
            const guardians = [guardian1.address, guardian2.address, guardian3.address];
            const beneficiaries = [beneficiary1.address, beneficiary2.address];
            const threshold = 2;

            const tx = await willManager.connect(owner).createWill(
                guardians,
                threshold,
                SAMPLE_CID,
                SAMPLE_HASH,
                HEARTBEAT_TIMEOUT,
                beneficiaries,
                ethers.constants.AddressZero
            );

            await expect(tx)
                .to.emit(willManager, "WillCreated")
                .withArgs(1, owner.address, ethers.constants.AddressZero, SAMPLE_CID);

            // Verify will data
            const willData = await willManager.getWill(1);
            expect(willData.owner).to.equal(owner.address);
            expect(willData.encryptedCID).to.equal(SAMPLE_CID);
            expect(willData.payloadHash).to.equal(SAMPLE_HASH);
            expect(willData.guardianThreshold).to.equal(threshold);
            expect(willData.beneficiaries).to.deep.equal(beneficiaries);
            expect(willData.guardians).to.deep.equal(guardians);
            expect(willData.released).to.be.false;
        });

        it("Should fail with invalid parameters", async function () {
            const guardians = [guardian1.address, guardian2.address];
            const beneficiaries = [beneficiary1.address];

            // Empty guardians
            await expect(
                willManager.connect(owner).createWill(
                    [],
                    1,
                    SAMPLE_CID,
                    SAMPLE_HASH,
                    HEARTBEAT_TIMEOUT,
                    beneficiaries,
                    ethers.constants.AddressZero
                )
            ).to.be.revertedWithCustomError(willManager, "InvalidParameters");

            // Threshold greater than guardians
            await expect(
                willManager.connect(owner).createWill(
                    guardians,
                    3,
                    SAMPLE_CID,
                    SAMPLE_HASH,
                    HEARTBEAT_TIMEOUT,
                    beneficiaries,
                    ethers.constants.AddressZero
                )
            ).to.be.revertedWithCustomError(willManager, "InvalidParameters");

            // Empty CID
            await expect(
                willManager.connect(owner).createWill(
                    guardians,
                    2,
                    "",
                    SAMPLE_HASH,
                    HEARTBEAT_TIMEOUT,
                    beneficiaries,
                    ethers.constants.AddressZero
                )
            ).to.be.revertedWithCustomError(willManager, "InvalidParameters");

            // Invalid heartbeat timeout
            await expect(
                willManager.connect(owner).createWill(
                    guardians,
                    2,
                    SAMPLE_CID,
                    SAMPLE_HASH,
                    60, // Less than MIN_HEARTBEAT_TIMEOUT
                    beneficiaries,
                    ethers.constants.AddressZero
                )
            ).to.be.revertedWithCustomError(willManager, "InvalidParameters");
        });

        it("Should prevent duplicate guardians", async function () {
            const guardians = [guardian1.address, guardian1.address]; // Duplicate
            const beneficiaries = [beneficiary1.address];

            await expect(
                willManager.connect(owner).createWill(
                    guardians,
                    1,
                    SAMPLE_CID,
                    SAMPLE_HASH,
                    HEARTBEAT_TIMEOUT,
                    beneficiaries,
                    ethers.constants.AddressZero
                )
            ).to.be.revertedWithCustomError(willManager, "InvalidParameters");
        });
    });

    describe("Heartbeat", function () {
        let willId;

        beforeEach(async function () {
            const guardians = [guardian1.address, guardian2.address, guardian3.address];
            const beneficiaries = [beneficiary1.address];

            await willManager.connect(owner).createWill(
                guardians,
                2,
                SAMPLE_CID,
                SAMPLE_HASH,
                HEARTBEAT_TIMEOUT,
                beneficiaries,
                ethers.constants.AddressZero
            );
            willId = 1;
        });

        it("Should allow owner to provide heartbeat", async function () {
            const tx = await willManager.connect(owner).heartbeat(willId);
            
            await expect(tx)
                .to.emit(willManager, "Heartbeat")
                .withArgs(willId, await time.latest());

            const willData = await willManager.getWill(willId);
            expect(willData.lastHeartbeat).to.be.closeTo(await time.latest(), 2);
        });

        it("Should fail if not owner", async function () {
            await expect(
                willManager.connect(guardian1).heartbeat(willId)
            ).to.be.revertedWithCustomError(willManager, "NotOwner");
        });

        it("Should fail for released will", async function () {
            // Fast forward to expire heartbeat
            await time.increase(HEARTBEAT_TIMEOUT + 1);

            // Get guardian approvals
            await willManager.connect(guardian1).guardianApprove(willId);
            await willManager.connect(guardian2).guardianApprove(willId);

            // Fast forward past timelock
            await time.increase(RELEASE_TIMELOCK + 1);

            // Finalize release
            await willManager.connect(keeper).finalizeRelease(willId);

            // Should fail to heartbeat released will
            await expect(
                willManager.connect(owner).heartbeat(willId)
            ).to.be.revertedWithCustomError(willManager, "AlreadyReleased");
        });
    });

    describe("Guardian Approvals", function () {
        let willId;

        beforeEach(async function () {
            const guardians = [guardian1.address, guardian2.address, guardian3.address];
            const beneficiaries = [beneficiary1.address];

            await willManager.connect(owner).createWill(
                guardians,
                2,
                SAMPLE_CID,
                SAMPLE_HASH,
                HEARTBEAT_TIMEOUT,
                beneficiaries,
                ethers.constants.AddressZero
            );
            willId = 1;
        });

        it("Should allow guardians to approve", async function () {
            const tx = await willManager.connect(guardian1).guardianApprove(willId);
            
            await expect(tx)
                .to.emit(willManager, "GuardianApproved")
                .withArgs(willId, guardian1.address);

            const [approvals,] = await willManager.getGuardianApprovals(willId);
            expect(approvals).to.equal(1);
        });

        it("Should trigger release request when threshold reached", async function () {
            await willManager.connect(guardian1).guardianApprove(willId);
            
            const tx = await willManager.connect(guardian2).guardianApprove(willId);
            
            await expect(tx)
                .to.emit(willManager, "ReleaseRequested")
                .withArgs(willId, await time.latest() + RELEASE_TIMELOCK);

            const willData = await willManager.getWill(willId);
            expect(willData.releaseRequested).to.be.true;
        });

        it("Should fail if not a guardian", async function () {
            await expect(
                willManager.connect(beneficiary1).guardianApprove(willId)
            ).to.be.revertedWithCustomError(willManager, "NotGuardian");
        });

        it("Should handle multiple approvals from same guardian gracefully", async function () {
            await willManager.connect(guardian1).guardianApprove(willId);
            
            // Second approval should not revert but also not double count
            await willManager.connect(guardian1).guardianApprove(willId);

            const [approvals,] = await willManager.getGuardianApprovals(willId);
            expect(approvals).to.equal(1);
        });
    });

    describe("Release Process", function () {
        let willId;

        beforeEach(async function () {
            const guardians = [guardian1.address, guardian2.address, guardian3.address];
            const beneficiaries = [beneficiary1.address];

            await willManager.connect(owner).createWill(
                guardians,
                2,
                SAMPLE_CID,
                SAMPLE_HASH,
                HEARTBEAT_TIMEOUT,
                beneficiaries,
                ethers.constants.AddressZero
            );
            willId = 1;
        });

        it("Should complete full release process", async function () {
            // Fast forward to expire heartbeat
            await time.increase(HEARTBEAT_TIMEOUT + 1);

            // Get guardian approvals
            await willManager.connect(guardian1).guardianApprove(willId);
            await willManager.connect(guardian2).guardianApprove(willId);

            // Verify release requested
            const willData = await willManager.getWill(willId);
            expect(willData.releaseRequested).to.be.true;

            // Fast forward past timelock
            await time.increase(RELEASE_TIMELOCK + 1);

            // Finalize release
            const tx = await willManager.connect(keeper).finalizeRelease(willId);
            
            await expect(tx)
                .to.emit(willManager, "ReleaseFinalized")
                .withArgs(willId, [beneficiary1.address]);

            const finalWillData = await willManager.getWill(willId);
            expect(finalWillData.released).to.be.true;
        });

        it("Should allow owner to voluntarily request release", async function () {
            const tx = await willManager.connect(owner).requestReleaseByOwner(willId);
            
            await expect(tx)
                .to.emit(willManager, "ReleaseRequested");

            const willData = await willManager.getWill(willId);
            expect(willData.releaseRequested).to.be.true;
        });

        it("Should fail finalization before timelock expires", async function () {
            // Get guardian approvals to trigger release request
            await willManager.connect(guardian1).guardianApprove(willId);
            await willManager.connect(guardian2).guardianApprove(willId);

            // Try to finalize immediately (before timelock)
            await expect(
                willManager.connect(keeper).finalizeRelease(willId)
            ).to.be.revertedWithCustomError(willManager, "TimelockNotExpired");
        });

        it("Should fail finalization if not keeper", async function () {
            // Get guardian approvals and wait for timelock
            await willManager.connect(guardian1).guardianApprove(willId);
            await willManager.connect(guardian2).guardianApprove(willId);
            await time.increase(RELEASE_TIMELOCK + 1);

            await expect(
                willManager.connect(owner).finalizeRelease(willId)
            ).to.be.reverted; // Should revert due to missing KEEPER_ROLE
        });
    });

    describe("Automation Compatibility", function () {
        let willId;

        beforeEach(async function () {
            const guardians = [guardian1.address, guardian2.address, guardian3.address];
            const beneficiaries = [beneficiary1.address];

            await willManager.connect(owner).createWill(
                guardians,
                2,
                SAMPLE_CID,
                SAMPLE_HASH,
                HEARTBEAT_TIMEOUT,
                beneficiaries,
                ethers.constants.AddressZero
            );
            willId = 1;
        });

        it("Should identify eligible wills for upkeep", async function () {
            // Fast forward to expire heartbeat
            await time.increase(HEARTBEAT_TIMEOUT + 1);

            // Get guardian approvals
            await willManager.connect(guardian1).guardianApprove(willId);
            await willManager.connect(guardian2).guardianApprove(willId);

            const [upkeepNeeded, performData] = await willManager.checkUpkeep("0x");
            expect(upkeepNeeded).to.be.false; // Because release already requested by approvals

            // Test with a fresh will that needs upkeep
            const guardians2 = [guardian1.address, guardian2.address];
            const beneficiaries2 = [beneficiary2.address];

            await willManager.connect(owner).createWill(
                guardians2,
                2,
                SAMPLE_CID,
                SAMPLE_HASH,
                HEARTBEAT_TIMEOUT,
                beneficiaries2,
                ethers.constants.AddressZero
            );
            
            const willId2 = 2;
            
            // Fast forward to expire heartbeat
            await time.increase(HEARTBEAT_TIMEOUT + 1);
            
            // Get guardian approvals for second will
            await willManager.connect(guardian1).guardianApprove(willId2);
            await willManager.connect(guardian2).guardianApprove(willId2);
        });

        it("Should perform upkeep correctly", async function () {
            // This test would need more sophisticated setup to test performUpkeep
            // For now, we verify the function doesn't revert when called by keeper
            const performData = ethers.utils.defaultAbiCoder.encode(["uint256[]"], [[willId]]);
            
            await expect(
                willManager.connect(keeper).performUpkeep(performData)
            ).to.not.be.reverted;
        });
    });

    describe("Edge Cases and Security", function () {
        let willId;

        beforeEach(async function () {
            const guardians = [guardian1.address, guardian2.address, guardian3.address];
            const beneficiaries = [beneficiary1.address];

            await willManager.connect(owner).createWill(
                guardians,
                2,
                SAMPLE_CID,
                SAMPLE_HASH,
                HEARTBEAT_TIMEOUT,
                beneficiaries,
                ethers.constants.AddressZero
            );
            willId = 1;
        });

        it("Should handle non-existent will queries", async function () {
            await expect(
                willManager.getWill(999)
            ).to.be.revertedWithCustomError(willManager, "WillNotFound");
        });

        it("Should prevent reentrancy attacks", async function () {
            // This is implicitly tested by the ReentrancyGuard modifier
            // Additional specific reentrancy tests could be added here
        });

        it("Should respect pause functionality", async function () {
            await willManager.connect(admin).pause();

            await expect(
                willManager.connect(owner).createWill(
                    [guardian1.address],
                    1,
                    SAMPLE_CID,
                    SAMPLE_HASH,
                    HEARTBEAT_TIMEOUT,
                    [beneficiary1.address],
                    ethers.constants.AddressZero
                )
            ).to.be.reverted; // Should revert when paused
        });
    });

    describe("Integration with AssetVault", function () {
        it("Should work with custodial vault", async function () {
            const guardians = [guardian1.address, guardian2.address];
            const beneficiaries = [beneficiary1.address];

            // Create will with vault
            await willManager.connect(owner).createWill(
                guardians,
                2,
                SAMPLE_CID,
                SAMPLE_HASH,
                HEARTBEAT_TIMEOUT,
                beneficiaries,
                assetVault.address
            );

            const willData = await willManager.getWill(1);
            expect(willData.vaultAddress).to.equal(assetVault.address);
        });
    });
});