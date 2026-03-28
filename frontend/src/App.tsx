import { useEffect, useMemo, useState } from 'react';
import { ForceGraph2D } from 'react-force-graph';

interface GraphNode {
  id: string;
  type: string;
}

interface GraphEdge {
  source: string;
  target: string;
  relation: string;
  explanation: string;
  evidence: string;
}

interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

const BACKEND_URL = 'http://localhost:8000';

function App() {
  const [graph, setGraph] = useState<GraphData>({ nodes: [], edges: [] });
  const [selectedEdge, setSelectedEdge] = useState<GraphEdge | null>(null);
  const [uploadLoading, setUploadLoading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  useEffect(() => {
    fetchGraph();
  }, []);

  const nodeColor = (node: GraphNode) => {
    switch (node.type) {
      case 'technology':
        return '#3b82f6';
      case 'application':
        return '#10b981';
      case 'method':
        return '#f59e0b';
      case 'author':
        return '#8b5cf6';
      default:
        return '#6b7280';
    }
  };

  const graphData = useMemo(
    () => ({
      nodes: graph.nodes,
      links: graph.edges.map(edge => ({ ...edge, source: edge.source, target: edge.target })),
    }),
    [graph]
  );

  async function fetchGraph() {
    try {
      const response = await fetch(`${BACKEND_URL}/graph`);
      if (!response.ok) throw new Error('Failed to fetch graph');
      const data = await response.json();
      setGraph(data);
    } catch (error) {
      console.error(error);
      setUploadError('Unable to load graph data.');
    }
  }

  async function handleUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    const formData = new FormData();
    for (const file of Array.from(files)) {
      formData.append('files', file);
    }

    setUploadError(null);
    setUploadLoading(true);
    try {
      const response = await fetch(`${BACKEND_URL}/upload`, {
        method: 'POST',
        body: formData,
      });
      if (!response.ok) throw new Error('Upload failed');
      const data = await response.json();
      setGraph(data);
      setSelectedEdge(null);
    } catch (error) {
      console.error(error);
      setUploadError('Upload failed. Please try again.');
    } finally {
      setUploadLoading(false);
    }
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <div>
          <h1>PaperGraph AI</h1>
          <p>Upload PDFs, generate a knowledge graph, and inspect relationships.</p>
        </div>
        <div className="upload-block">
          <label className="upload-label">
            <span>Upload papers</span>
            <input type="file" accept="application/pdf" multiple onChange={handleUpload} />
          </label>
          {uploadLoading && <span className="status">Extracting relationships...</span>}
          {uploadError && <span className="error">{uploadError}</span>}
        </div>
      </header>

      <main className="content-grid">
        <section className="graph-panel">
          {graph.nodes.length === 0 ? (
            <div className="empty-state">
              <p>No graph data available yet.</p>
              <p>Upload PDFs to generate the graph.</p>
            </div>
          ) : (
            <ForceGraph2D
              graphData={graphData}
              nodeLabel="id"
              nodeAutoColorBy="type"
              nodeCanvasObject={(node: any, ctx: any, globalScale: number) => {
                const label = (node as GraphNode).id;
                const fontSize = 10 / globalScale;
                ctx.fillStyle = nodeColor(node as GraphNode);
                ctx.beginPath();
                ctx.arc(node.x ?? 0, node.y ?? 0, 6, 0, 2 * Math.PI, false);
                ctx.fill();
                ctx.font = `${fontSize}px Sans-Serif`;
                ctx.fillStyle = '#111';
                ctx.fillText(label, (node.x ?? 0) + 8, (node.y ?? 0) + 4);
              }}
              linkDirectionalArrowLength={4}
              linkDirectionalArrowRelPos={1}
              onLinkClick={(link: any) => {
                setSelectedEdge(link as GraphEdge);
              }}
            />
          )}
        </section>

        <aside className="details-panel">
          <h2>Connection details</h2>
          {selectedEdge ? (
            <div className="edge-card">
              <p className="edge-title">{selectedEdge.source} → {selectedEdge.target}</p>
              <p><strong>Relation:</strong> {selectedEdge.relation}</p>
              <p><strong>Explanation:</strong> {selectedEdge.explanation}</p>
              <p><strong>Evidence:</strong> {selectedEdge.evidence}</p>
            </div>
          ) : (
            <div className="empty-state">
              <p>Click an edge in the graph to see its explanation and evidence.</p>
            </div>
          )}
        </aside>
      </main>
    </div>
  );
}

export default App;
