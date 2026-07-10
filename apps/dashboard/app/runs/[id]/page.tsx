import { RunTrace } from "../../../components/RunTrace";

export default function RunPage({ params }: { params: { id: string } }) {
  return <RunTrace runId={params.id} />;
}
