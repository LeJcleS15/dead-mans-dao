import React, { useState, useEffect } from 'react';
import { ethers } from 'ethers';
import styled, { ThemeProvider, createGlobalStyle } from 'styled-components';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Skull, 
  Shield, 
  Clock, 
  Users, 
  Vault, 
  Heart, 
  ChevronRight,
  Wallet,
  Copy,
  ExternalLink,
  Plus,
  Eye,
  Settings
} from 'lucide-react';
import toast, { Toaster } from 'react-hot-toast';

// Import contract ABIs (you'll need to copy these from artifacts after compilation)
import WillManagerABI from './contracts/WillManager.json';
import AssetVaultABI from './contracts/AssetVault.json';
import GuardianRegistryABI from './contracts/GuardianRegistry.json';

const theme = {
  colors: {
    primary: '#8B5CF6',
    secondary: '#10B981',
    accent: '#F59E0B',
    danger: '#EF4444',
    dark: '#1F2937',
    darker: '#111827',
    light: '#F9FAFB',
    gray: '#6B7280',
    white: '#FFFFFF'
  },
  fonts: {
    primary: '"Inter", sans-serif',
    mono: '"JetBrains Mono", monospace'
  },
  shadows: {
    small: '0 1px 3px 0 rgba(0, 0, 0, 0.1)',
    medium: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
    large: '0 20px 25px -5px rgba(0, 0, 0, 0.1)'
  }
};

const GlobalStyle = createGlobalStyle`
  * {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
  }

  body {
    font-family: ${props => props.theme.fonts.primary};
    background: linear-gradient(135deg, ${props => props.theme.colors.darker} 0%, ${props => props.theme.colors.dark} 100%);
    color: ${props => props.theme.colors.white};
    min-height: 100vh;
  }

  a {
    color: inherit;
    text-decoration: none;
  }
`;

const Container = styled.div`
  max-width: 1400px;
  margin: 0 auto;
  padding: 0 24px;
`;

const Header = styled.header`
  padding: 24px 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  backdrop-filter: blur(10px);
  position: sticky;
  top: 0;
  z-index: 100;
`;

const HeaderContent = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
`;

const Logo = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 24px;
  font-weight: 700;
  background: linear-gradient(135deg, ${props => props.theme.colors.primary}, ${props => props.theme.colors.secondary});
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
`;

const ConnectButton = styled.button`
  background: linear-gradient(135deg, ${props => props.theme.colors.primary}, ${props => props.theme.colors.secondary});
  border: none;
  padding: 12px 24px;
  border-radius: 12px;
  color: white;
  font-weight: 600;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 8px;
  transition: all 0.3s ease;

  &:hover {
    transform: translateY(-2px);
    box-shadow: ${props => props.theme.shadows.large};
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
    transform: none;
  }
`;

const Main = styled.main`
  padding: 48px 0;
`;

const Hero = styled.section`
  text-align: center;
  margin-bottom: 80px;
`;

const HeroTitle = styled(motion.h1)`
  font-size: 72px;
  font-weight: 900;
  margin-bottom: 24px;
  background: linear-gradient(135deg, ${props => props.theme.colors.white}, ${props => props.theme.colors.gray});
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  line-height: 1.1;
`;

const HeroSubtitle = styled(motion.p)`
  font-size: 24px;
  color: ${props => props.theme.colors.gray};
  margin-bottom: 48px;
  max-width: 800px;
  margin-left: auto;
  margin-right: auto;
  line-height: 1.5;
`;

const FeatureGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  gap: 32px;
  margin-bottom: 80px;
`;

const FeatureCard = styled(motion.div)`
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 20px;
  padding: 32px;
  text-align: center;
  backdrop-filter: blur(10px);
  transition: all 0.3s ease;

  &:hover {
    background: rgba(255, 255, 255, 0.1);
    border-color: ${props => props.theme.colors.primary};
    transform: translateY(-4px);
  }
`;

const FeatureIcon = styled.div`
  width: 80px;
  height: 80px;
  border-radius: 20px;
  background: linear-gradient(135deg, ${props => props.theme.colors.primary}, ${props => props.theme.colors.secondary});
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0 auto 24px;
`;

const FeatureTitle = styled.h3`
  font-size: 24px;
  font-weight: 700;
  margin-bottom: 16px;
`;

const FeatureDescription = styled.p`
  color: ${props => props.theme.colors.gray};
  line-height: 1.6;
`;

const ActionSection = styled.section`
  text-align: center;
  margin-bottom: 80px;
`;

const ActionTitle = styled.h2`
  font-size: 48px;
  font-weight: 800;
  margin-bottom: 24px;
`;

const ActionGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(350px, 1fr));
  gap: 32px;
  margin-top: 48px;
`;

const ActionCard = styled(motion.div)`
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 20px;
  padding: 40px;
  backdrop-filter: blur(10px);
  position: relative;
  overflow: hidden;

  &::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 4px;
    background: linear-gradient(135deg, ${props => props.theme.colors.primary}, ${props => props.theme.colors.secondary});
  }
`;

const ActionButton = styled.button`
  background: linear-gradient(135deg, ${props => props.theme.colors.primary}, ${props => props.theme.colors.secondary});
  border: none;
  padding: 16px 32px;
  border-radius: 12px;
  color: white;
  font-weight: 600;
  font-size: 18px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  width: 100%;
  margin-top: 24px;
  transition: all 0.3s ease;

  &:hover {
    transform: translateY(-2px);
    box-shadow: ${props => props.theme.shadows.large};
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
    transform: none;
  }
`;

const StatusCard = styled.div`
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 16px;
  padding: 24px;
  margin-bottom: 32px;
`;

const StatusGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 24px;
`;

const StatusItem = styled.div`
  text-align: center;
`;

const StatusValue = styled.div`
  font-size: 32px;
  font-weight: 800;
  color: ${props => props.theme.colors.primary};
  margin-bottom: 8px;
`;

const StatusLabel = styled.div`
  color: ${props => props.theme.colors.gray};
  font-size: 14px;
`;

const WalletInfo = styled.div`
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 12px;
  padding: 16px 20px;
  display: flex;
  align-items: center;
  gap: 12px;
  font-family: ${props => props.theme.fonts.mono};
  font-size: 14px;
`;

function App() {
  const [account, setAccount] = useState(null);
  const [provider, setProvider] = useState(null);
  const [signer, setSigner] = useState(null);
  const [contracts, setContracts] = useState({});
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState({
    totalWills: 0,
    totalGuardians: 0,
    totalAssets: 0
  });

  // Contract addresses (these would come from deployment)
  const CONTRACT_ADDRESSES = {
    willManager: "0x...", // Add after deployment
    assetVault: "0x...",  // Add after deployment
    guardianRegistry: "0x..." // Add after deployment
  };

  useEffect(() => {
    checkWalletConnection();
  }, []);

  const checkWalletConnection = async () => {
    if (window.ethereum) {
      try {
        const accounts = await window.ethereum.request({ method: 'eth_accounts' });
        if (accounts.length > 0) {
          await connectWallet();
        }
      } catch (error) {
        console.error('Error checking wallet connection:', error);
      }
    }
  };

  const connectWallet = async () => {
    if (!window.ethereum) {
      toast.error('Please install MetaMask to continue');
      return;
    }

    try {
      setLoading(true);
      const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
      const provider = new ethers.BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();
      
      setAccount(accounts[0]);
      setProvider(provider);
      setSigner(signer);

      // Initialize contracts
      if (CONTRACT_ADDRESSES.willManager !== "0x...") {
        const willManager = new ethers.Contract(
          CONTRACT_ADDRESSES.willManager, 
          WillManagerABI.abi, 
          signer
        );
        const assetVault = new ethers.Contract(
          CONTRACT_ADDRESSES.assetVault, 
          AssetVaultABI.abi, 
          signer
        );
        const guardianRegistry = new ethers.Contract(
          CONTRACT_ADDRESSES.guardianRegistry, 
          GuardianRegistryABI.abi, 
          signer
        );

        setContracts({ willManager, assetVault, guardianRegistry });
        await loadStats({ willManager, guardianRegistry, assetVault });
      }

      toast.success('Wallet connected successfully!');
    } catch (error) {
      console.error('Error connecting wallet:', error);
      toast.error('Failed to connect wallet');
    } finally {
      setLoading(false);
    }
  };

  const loadStats = async (contracts) => {
    try {
      const [nextWillId, guardianCount] = await Promise.all([
        contracts.willManager.nextWillId(),
        contracts.guardianRegistry.getGuardianCount()
      ]);

      setStats({
        totalWills: Number(nextWillId) - 1,
        totalGuardians: Number(guardianCount),
        totalAssets: 0 // Would calculate from vault
      });
    } catch (error) {
      console.error('Error loading stats:', error);
    }
  };

  const createWill = async () => {
    if (!contracts.willManager) {
      toast.error('Please connect your wallet first');
      return;
    }

    // This would open a modal or navigate to a creation form
    toast.success('Will creation flow would start here');
  };

  const becomeGuardian = async () => {
    if (!contracts.guardianRegistry) {
      toast.error('Please connect your wallet first');
      return;
    }

    // This would open guardian registration flow
    toast.success('Guardian registration flow would start here');
  };

  const manageAssets = async () => {
    if (!contracts.assetVault) {
      toast.error('Please connect your wallet first');
      return;
    }

    // This would open asset management interface
    toast.success('Asset management interface would open here');
  };

  const features = [
    {
      icon: <Skull size={40} />,
      title: "Autonomous Execution",
      description: "Your will executes automatically when conditions are met. No lawyers, no courts, no intermediaries."
    },
    {
      icon: <Shield size={40} />,
      title: "Cryptographic Security",
      description: "Advanced encryption and threshold cryptography ensure your secrets remain secure until release."
    },
    {
      icon: <Clock size={40} />,
      title: "Time-Locked Release",
      description: "Multi-layered time locks and heartbeat mechanisms provide multiple safeguards against premature release."
    },
    {
      icon: <Users size={40} />,
      title: "Guardian Network",
      description: "Distributed guardians with reputation systems ensure trustless but reliable will execution."
    },
    {
      icon: <Vault size={40} />,
      title: "Multi-Asset Support",
      description: "Secure ETH, ERC20 tokens, NFTs, and encrypted data. Everything in one decentralized vault."
    },
    {
      icon: <Heart size={40} />,
      title: "Proof of Life",
      description: "Sophisticated heartbeat and oracle systems verify life status through multiple independent sources."
    }
  ];

  return (
    <ThemeProvider theme={theme}>
      <GlobalStyle />
      <div className="App">
        <Header>
          <Container>
            <HeaderContent>
              <Logo>
                <Skull size={32} />
                Dead Man's DAO
              </Logo>
              
              {account ? (
                <WalletInfo>
                  <Wallet size={16} />
                  {account.slice(0, 6)}...{account.slice(-4)}
                  <Copy 
                    size={16} 
                    style={{ cursor: 'pointer' }} 
                    onClick={() => {
                      navigator.clipboard.writeText(account);
                      toast.success('Address copied!');
                    }}
                  />
                </WalletInfo>
              ) : (
                <ConnectButton onClick={connectWallet} disabled={loading}>
                  <Wallet size={20} />
                  {loading ? 'Connecting...' : 'Connect Wallet'}
                </ConnectButton>
              )}
            </HeaderContent>
          </Container>
        </Header>

        <Main>
          <Container>
            <Hero>
              <HeroTitle
                initial={{ opacity: 0, y: 50 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.8 }}
              >
                Your Legacy, <br />
                Secured Forever
              </HeroTitle>
              <HeroSubtitle
                initial={{ opacity: 0, y: 30 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.8, delay: 0.2 }}
              >
                The world's first fully decentralized digital inheritance system. 
                Your secrets, assets, and wishes protected by mathematics, 
                not institutions.
              </HeroSubtitle>
            </Hero>

            {account && (
              <StatusCard>
                <StatusGrid>
                  <StatusItem>
                    <StatusValue>{stats.totalWills}</StatusValue>
                    <StatusLabel>Active Wills</StatusLabel>
                  </StatusItem>
                  <StatusItem>
                    <StatusValue>{stats.totalGuardians}</StatusValue>
                    <StatusLabel>Registered Guardians</StatusLabel>
                  </StatusItem>
                  <StatusItem>
                    <StatusValue>{stats.totalAssets}</StatusValue>
                    <StatusLabel>Protected Assets</StatusLabel>
                  </StatusItem>
                </StatusGrid>
              </StatusCard>
            )}

            <FeatureGrid>
              {features.map((feature, index) => (
                <FeatureCard
                  key={index}
                  initial={{ opacity: 0, y: 50 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.6, delay: index * 0.1 }}
                  whileHover={{ scale: 1.02 }}
                >
                  <FeatureIcon>
                    {feature.icon}
                  </FeatureIcon>
                  <FeatureTitle>{feature.title}</FeatureTitle>
                  <FeatureDescription>{feature.description}</FeatureDescription>
                </FeatureCard>
              ))}
            </FeatureGrid>

            <ActionSection>
              <ActionTitle>Take Control of Your Legacy</ActionTitle>
              
              <ActionGrid>
                <ActionCard
                  initial={{ opacity: 0, x: -50 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.6 }}
                >
                  <FeatureIcon>
                    <Plus size={40} />
                  </FeatureIcon>
                  <FeatureTitle>Create Your Will</FeatureTitle>
                  <FeatureDescription>
                    Encrypt your secrets, select guardians, and set release conditions. 
                    Your digital inheritance, secured on-chain forever.
                  </FeatureDescription>
                  <ActionButton onClick={createWill}>
                    Create Will <ChevronRight size={20} />
                  </ActionButton>
                </ActionCard>

                <ActionCard
                  initial={{ opacity: 0, y: 50 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.6, delay: 0.1 }}
                >
                  <FeatureIcon>
                    <Users size={40} />
                  </FeatureIcon>
                  <FeatureTitle>Become a Guardian</FeatureTitle>
                  <FeatureDescription>
                    Join the guardian network and help secure others' legacies. 
                    Earn reputation and contribute to the decentralized future.
                  </FeatureDescription>
                  <ActionButton onClick={becomeGuardian}>
                    Join Guardians <Shield size={20} />
                  </ActionButton>
                </ActionCard>

                <ActionCard
                  initial={{ opacity: 0, x: 50 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.6, delay: 0.2 }}
                >
                  <FeatureIcon>
                    <Vault size={40} />
                  </FeatureIcon>
                  <FeatureTitle>Manage Assets</FeatureTitle>
                  <FeatureDescription>
                    Deposit crypto assets, NFTs, and encrypted data. 
                    Monitor your vault and guardian status in real-time.
                  </FeatureDescription>
                  <ActionButton onClick={manageAssets}>
                    Manage Vault <Settings size={20} />
                  </ActionButton>
                </ActionCard>
              </ActionGrid>
            </ActionSection>
          </Container>
        </Main>
        
        <Toaster 
          position="bottom-right"
          toastOptions={{
            style: {
              background: theme.colors.dark,
              color: theme.colors.white,
              border: `1px solid ${theme.colors.primary}`
            }
          }}
        />
      </div>
    </ThemeProvider>
  );
}

export default App;