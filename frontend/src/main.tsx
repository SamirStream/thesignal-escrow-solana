import { Buffer } from 'buffer';
(window as any).Buffer = Buffer;

import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { WalletProviderWrapper } from './components/WalletProvider';
import { UnifiedWalletProvider } from './components/UnifiedWalletProvider';
import { ErrorBoundary } from './components/ErrorBoundary';
import { PrivyProvider } from '@privy-io/react-auth';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <PrivyProvider
        appId={import.meta.env.VITE_PRIVY_APP_ID ?? ''}
        config={{
          appearance: {
            theme: 'dark',
            accentColor: '#10b981',
          },
          loginMethods: ['email', 'google', 'twitter', 'discord'],
          embeddedWallets: {
            ethereum: { createOnLogin: 'off' },
          },
          solanaClusters: [
            { name: 'devnet', rpcUrl: 'https://api.devnet.solana.com' },
            { name: 'mainnet-beta', rpcUrl: 'https://api.mainnet-beta.solana.com' },
          ],
        }}
      >
        <WalletProviderWrapper>
          <UnifiedWalletProvider>
            <App />
          </UnifiedWalletProvider>
        </WalletProviderWrapper>
      </PrivyProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);
