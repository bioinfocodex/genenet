import ProcedureEditor from '@/components/ProcedureEditor';

export default function NewProcedurePage() {
  return (
    <div>
      <h1 className="title-gradient" style={{ fontSize: '2rem', marginBottom: '2rem' }}>New Procedure</h1>
      <ProcedureEditor />
    </div>
  );
}
