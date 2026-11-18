import { useAccount } from '../lib/useAccount';

/** Account button in the header: the Google avatar when signed in, a person icon otherwise. */
export default function HeaderAccount({ href, current }: { href: string; current: boolean }) {
  const { account } = useAccount();
  const label = account ? `Account: ${account.name || account.email}` : 'Account and settings';
  return (
    <a className={`acct-btn${account ? ' acct-btn--in' : ''}`} href={href} aria-label={label} title={label} aria-current={current ? 'page' : undefined}>
      {account?.photo ? <img src={account.photo} alt="" referrerPolicy="no-referrer" /> : account ? <span>{(account.name || account.email).slice(0, 1).toUpperCase()}</span> : (
        <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><use href="#i-user" /></svg>
      )}
    </a>
  );
}
