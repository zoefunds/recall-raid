'use client';

import { useAccount } from 'wagmi';

declare global {
  // Reown AppKit registers a custom element; typing it loosely here keeps
  // this file dependency-free of AppKit's web-component type package.
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      'appkit-button': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
        balance?: 'show' | 'hide';
      };
    }
  }
}

export function ConnectWalletButton() {
  // `address`/`isConnected` aren't rendered directly here — AppKit's own
  // web component already reflects connection state (shows the truncated
  // address once connected) — but keeping the hook wired up here means
  // this component re-renders (and stays in sync) on account changes.
  useAccount();

  return (
    <div className="relative">
      {/* AppKit's own web component drives the connect modal; it renders
          its own trigger UI ("Connect Wallet" -> truncated address once
          connected) so no label prop is needed. */}
      <appkit-button balance="hide" />
    </div>
  );
}

export function useConnectedAddress() {
  const { address, isConnected, isConnecting } = useAccount();
  return { address, isConnected, isConnecting };
}
