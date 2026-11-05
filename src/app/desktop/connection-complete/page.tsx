export default async function Complete({ searchParams }: { searchParams: Promise<{ result?: string }> }) {
    const failed = (await searchParams).result === 'error';
    return <main className="max-w-lg mx-auto p-10 space-y-4"><h1 className="text-2xl font-semibold">{failed ? 'Connection not completed' : 'Connection completed'}</h1><p>Return to Nucleas Desktop. Your Nucleas window will refresh automatically{failed ? ' with the error details' : ''}.</p><p className="text-text-secondary">You can close this browser tab.</p></main>;
}
