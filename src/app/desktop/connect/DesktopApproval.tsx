'use client';
import { useState } from 'react';
export default function DesktopApproval({ requestId }: { requestId: string }) {
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState('');
    const [done, setDone] = useState(false);
    async function approve() {
        setBusy(true);
        try {
            const response = await fetch('/api/auth/desktop', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'approve', requestId }) });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || 'Could not connect. Try again.');
            setDone(true);
            setMessage('Connected. Return to Nucleas Desktop; your app will open automatically.');
        } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not connect. Try again.'); }
        finally { setBusy(false); }
    }
    return <><button className="ui-button" disabled={busy || done} onClick={approve}>{busy ? 'Connecting…' : done ? 'Connected' : 'Connect this desktop'}</button><p role="status">{message}</p></>;
}
