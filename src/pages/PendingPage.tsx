import { Hourglass, LogOut, RefreshCw } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { toast } from '../lib/alerts';

export default function PendingPage() {
  const { profile, signOut, refreshProfile } = useAuth();
  return (
    <div className="center-screen">
      <div className="card pending-card page-enter">
        <div className="pending-orb">
          <Hourglass size={28} strokeWidth={1.4} />
        </div>
        <h1 className="display">Almost there, {profile?.full_name?.split(' ')[0] || 'friend'}.</h1>
        <p className="muted">
          Your staff account is waiting for an admin to approve it. This page updates by itself once you're in.
        </p>
        <div className="row gap center">
          <button
            className="btn btn-ghost"
            onClick={async () => {
              await refreshProfile();
              toast('Checked — still pending', 'info');
            }}
          >
            <RefreshCw size={15} /> Check again
          </button>
          <button className="btn btn-ghost" onClick={signOut}>
            <LogOut size={15} /> Sign out
          </button>
        </div>
      </div>
    </div>
  );
}
