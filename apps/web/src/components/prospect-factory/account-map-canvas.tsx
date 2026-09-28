"use client";

import { useEffect, useMemo, useRef } from "react";
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
  type Node,
  type NodeProps,
  type Viewport
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Building2, CircleHelp, UserRound } from "lucide-react";
import styles from "./account-map.module.css";

export type MapCanvasNode = {
  id: string;
  kind: "person" | "unit" | "role_slot";
  name: string;
  title?: string | null;
  unitKind?: string | null;
  status?: string | null;
  position: { x: number; y: number };
};

export type MapCanvasEdge = {
  id: string;
  source: string;
  target: string;
  kind: string;
  label?: string | null;
  status?: string | null;
};

type CanvasProps = {
  nodes: MapCanvasNode[];
  edges: MapCanvasEdge[];
  focusNodeId: string | null;
  selectedNodeId: string | null;
  initialViewport?: Viewport | null;
  onSelectNode: (id: string) => void;
  onSelectEdge: (id: string) => void;
  onConnect: (connection: Connection) => void;
  onMoveNode: (id: string, position: { x: number; y: number }) => void;
  onViewportChange: (viewport: Viewport) => void;
};

type CardData = MapCanvasNode & { label: string };

function GraphCard({ data, selected }: NodeProps<Node<CardData>>) {
  const Icon = data.kind === "person" ? UserRound : data.kind === "unit" ? Building2 : CircleHelp;
  return <div className={`${styles.graphCard} ${styles[`graphCard_${data.kind}`]} ${selected ? styles.graphCardSelected : ""}`}>
    <Handle type="target" position={Position.Top} className={styles.handle} />
    <span className={styles.graphCardIcon}><Icon size={15} aria-hidden="true" /></span>
    <div className={styles.graphCardText}>
      <strong>{data.name}</strong>
      <small>{data.title || data.label}</small>
    </div>
    {data.status ? <span className={styles.graphCardStatus}>{data.status}</span> : null}
    <Handle type="source" position={Position.Bottom} className={styles.handle} />
  </div>;
}

const nodeTypes = { accountMapCard: GraphCard };

function CanvasInner({ nodes: items, edges: links, focusNodeId, selectedNodeId, initialViewport, onSelectNode, onSelectEdge, onConnect, onMoveNode, onViewportChange }: CanvasProps) {
  const flow = useReactFlow();
  const suppressNodeClickUntil = useRef(0);
  const mappedNodes = useMemo<Node<CardData>[]>(() => items.map((item) => ({
    id: item.id,
    type: "accountMapCard",
    position: item.position,
    selected: item.id === selectedNodeId,
    data: { ...item, label: item.kind === "person" ? "Personne" : item.kind === "unit" ? item.unitKind || "Unité" : "Fonction à identifier" }
  })), [items, selectedNodeId]);
  const [nodes, , onNodesChange] = useNodesState<Node<CardData>>(mappedNodes);

  const edges = useMemo<Edge[]>(() => links.map((link) => ({
    id: link.id,
    source: link.source,
    target: link.target,
    label: link.label || link.kind.replaceAll("_", " "),
    type: "smoothstep",
    animated: false,
    className: `${styles.graphEdge} ${styles[`graphEdge_${link.status || "unknown"}`]}`,
    style: { stroke: link.status === "pending" ? "#a7620c" : link.status === "confirmed" ? "#3657c8" : "#667994", strokeWidth: link.status === "pending" ? 2.5 : 2, strokeDasharray: link.status === "pending" ? "9 5" : link.status === "hypothesis" ? "6 5" : link.status === "contradictory" || link.status === "obsolete" ? "2 4" : undefined },
    labelStyle: { fill: link.status === "pending" ? "#8a510a" : "#33435e", fontSize: 11, fontWeight: 650 },
    labelBgStyle: { fill: "#fff", fillOpacity: .95 },
    labelBgPadding: [5, 3],
    markerEnd: { type: MarkerType.ArrowClosed, color: link.status === "pending" ? "#a7620c" : link.status === "confirmed" ? "#3657c8" : "#667994" }
  })), [links]);

  useEffect(() => {
    if (!focusNodeId || !items.some((item) => item.id === focusNodeId)) return;
    const frame = requestAnimationFrame(() => { void flow.fitView({ nodes: [{ id: focusNodeId }], duration: 350, padding: .8, maxZoom: 1.4 }); });
    return () => cancelAnimationFrame(frame);
  }, [flow, focusNodeId, items]);

  return <ReactFlow
    nodes={nodes}
    edges={edges}
    nodeTypes={nodeTypes}
    onNodesChange={onNodesChange}
    onNodeClick={(_, node) => { if (Date.now() >= suppressNodeClickUntil.current) onSelectNode(node.id); }}
    onEdgeClick={(_, edge) => onSelectEdge(edge.id)}
    onConnectStart={() => { suppressNodeClickUntil.current = Number.POSITIVE_INFINITY; }}
    onConnect={(connection) => { suppressNodeClickUntil.current = Date.now() + 300; onConnect(connection); }}
    onConnectEnd={() => { suppressNodeClickUntil.current = Date.now() + 300; }}
    onNodeDragStop={(_, node) => onMoveNode(node.id, node.position)}
    onMoveEnd={(_, viewport) => onViewportChange(viewport)}
    defaultViewport={initialViewport || { x: 0, y: 0, zoom: 1 }}
    fitView={!initialViewport}
    fitViewOptions={{ padding: .25, maxZoom: 1 }}
    minZoom={.2}
    maxZoom={2}
    nodesConnectable
    nodesDraggable
    edgesFocusable
    nodesFocusable
    aria-label="Cartographie interactive du compte"
  >
    <Background color="#e3e9f4" gap={18} />
    <Controls position="bottom-left" showInteractive={false} />
  </ReactFlow>;
}

export default function AccountMapCanvas(props: CanvasProps) {
  return <div className={styles.canvas} role="region" aria-label="Graphe de l’entreprise"><ReactFlowProvider><CanvasInner {...props} /></ReactFlowProvider></div>;
}
