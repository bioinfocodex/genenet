import { createExperiment } from '@/app/actions/experiments';

export default async function NewExperimentPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const params = await searchParams;
  const requestedProtocol = typeof params?.protocol === 'string' ? params.protocol : 'PCR';

  const protocols = [
    "PCR",
    "Plasmid extraction",
    "Restriction digestion",
    "Fragment ligation",
    "Plasmid construction",
    "Colonies PCR",
    "Transformation to yeast"
  ];

  return (
    <div style={{ maxWidth: '800px', margin: '0 auto' }}>
      <h1 className="title-gradient" style={{ fontSize: '2rem', marginBottom: '2rem' }}>Log New Experiment</h1>
      
      <form action={createExperiment} className="glass-panel" style={{ padding: '2rem', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
        
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <label style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--text-primary)' }}>Experiment Title</label>
          <input type="text" name="title" required className="input-control" placeholder="e.g. Amplification of GFP from pUC19" />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <label style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--text-primary)' }}>Protocol</label>
          <select name="protocol" defaultValue={requestedProtocol} className="input-control" style={{ background: 'white' }}>
            {protocols.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <label style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--text-primary)' }}>Result Notes / Methodology</label>
          <textarea name="notes" className="input-control" rows={4} placeholder="Initial observations, buffer concentrations used, etc." style={{ resize: 'vertical' }}></textarea>
        </div>

        <div style={{ padding: '1.5rem', background: 'var(--bg-primary)', borderRadius: '8px', border: '1px solid var(--glass-border)', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
           <h3 style={{ fontSize: '1rem', color: 'var(--accent-blue)', margin: 0 }}>Expected Result Simulation Settings</h3>
           <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: 0 }}>Fill these out to auto-generate biological visualizations inside the hub.</p>
           
           {(requestedProtocol.includes('PCR')) ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <label style={{ fontWeight: 500, fontSize: '0.85rem' }}>Expected DNA Band Sizes (bp)</label>
                <input type="text" name="bandSize" className="input-control" placeholder="e.g. 500, 1200" />
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Comma separated list of fragment sizes for the Agarose gel lane.</span>
              </div>
           ) : (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                 <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    <label style={{ fontWeight: 500, fontSize: '0.85rem' }}>Construct/Plasmid Name</label>
                    <input type="text" name="plasmidName" className="input-control" placeholder="e.g. pDEST-GFP" />
                 </div>
                 <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    <label style={{ fontWeight: 500, fontSize: '0.85rem' }}>Total Base Pairs</label>
                    <input type="number" name="totalBp" className="input-control" placeholder="e.g. 5000" />
                 </div>
                 <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', gridColumn: '1 / -1' }}>
                    <label style={{ fontWeight: 500, fontSize: '0.85rem' }}>Restriction Sites (Enzyme & Position)</label>
                    <input type="text" name="cuts" className="input-control" placeholder="e.g. EcoRI 400, BamHI 1200" />
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Format: EnzymeName Position (comma separated)</span>
                 </div>
              </div>
           )}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1rem' }}>
           <button type="submit" className="btn btn-primary" style={{ padding: '0.75rem 2rem', fontSize: '1rem' }}>Log Experiment</button>
        </div>

      </form>
    </div>
  );
}
