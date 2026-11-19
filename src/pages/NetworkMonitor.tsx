import { useEffect, useMemo, useState } from "react";

type ConnectionStatus = "expected" | "review";
type NetworkEvent = { id: number; time: string; destination: string; protocol: string; port: number; status: ConnectionStatus; detail: string };

const expectedDestinations = [
  ["github.com", "HTTPS", 443, "Repository checkout"],
  ["registry.npmjs.org", "HTTPS", 443, "Package metadata"],
  ["api.osv.dev", "HTTPS", 443, "Advisory lookup"],
] as const;
const reviewDestinations = [
  ["untrusted-endpoint.invalid", "HTTPS", 443, "Outside the scanner allowlist"],
  ["198.51.100.42", "TCP", 8443, "Unrecognised destination"],
] as const;

function createEvent(id: number): NetworkEvent {
  const isReview = Math.random() < 0.24;
  const source = isReview ? reviewDestinations : expectedDestinations;
  const [destination, protocol, port, detail] = source[Math.floor(Math.random() * source.length)];
  return { id, time: new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date()), destination, protocol, port, status: isReview ? "review" : "expected", detail };
}

export default function NetworkMonitor() {
  const [events, setEvents] = useState<NetworkEvent[]>(() => [createEvent(1), createEvent(2), createEvent(3)]);
  const [running, setRunning] = useState(false);
  const [session, setSession] = useState(1);
  useEffect(() => {
    if (!running) return undefined;
    const timer = window.setInterval(() => setEvents((current) => [createEvent(Date.now()), ...current].slice(0, 8)), 1100);
    return () => window.clearInterval(timer);
  }, [running]);
  const reviewCount = useMemo(() => events.filter((event) => event.status === "review").length, [events]);
  const reset = () => { setRunning(false); setSession((value) => value + 1); setEvents([createEvent(Date.now()), createEvent(Date.now() + 1), createEvent(Date.now() + 2)]); };

  return <div className="page network-monitor-page">
    <div className="page-header"><div><span className="eyebrow">Advanced scope - telemetry preview</span><h1>Scanner network monitor</h1><p className="muted">Outbound connection evidence for an isolated scanner session.</p></div><div className="network-actions"><button className="btn" onClick={reset}>Reset session</button><button className="btn btn-primary" onClick={() => setRunning((value) => !value)}><span className={running ? "recording-dot" : ""} />{running ? "Pause stream" : "Start stream"}</button></div></div>
    <div className="telemetry-notice" role="note"><strong>Telemetry preview.</strong> Live collection is connected when scanner isolation and host-level capture are enabled.</div>
    <section className="network-summary" aria-label="Network monitor summary">
      <article className="card network-stat"><span className="network-stat-label">Session</span><strong>SCAN-{String(session).padStart(3, "0")}</strong><small>short-lived scanner</small></article>
      <article className="card network-stat"><span className="network-stat-label">Observed events</span><strong>{events.length}</strong><small>scanner telemetry</small></article>
      <article className="card network-stat"><span className="network-stat-label">Needs review</span><strong className={reviewCount ? "review-text" : "safe-text"}>{reviewCount}</strong><small>policy comparison</small></article>
      <article className="card network-stat"><span className="network-stat-label">Policy</span><strong className="safe-text">Allowlist</strong><small>3 expected services</small></article>
    </section>
    <section className="network-layout"><article className="card network-card"><div className="section-heading"><div><h2>Connection timeline</h2><p>Most recent scanner connections.</p></div><span className={`monitor-state ${running ? "monitoring" : ""}`}>{running ? "Recording" : "Ready"}</span></div><div className="telemetry-table" role="table" aria-label="Network telemetry"><div className="telemetry-row telemetry-head" role="row"><span>Time</span><span>Destination</span><span>Transport</span><span>Policy</span></div>{events.map((event) => <div className="telemetry-row" role="row" key={event.id}><span className="telemetry-time">{event.time}</span><span><strong>{event.destination}</strong><small>{event.detail}</small></span><span>{event.protocol} : {event.port}</span><span className={`policy-badge ${event.status}`}>{event.status === "expected" ? "Allowed" : "Review"}</span></div>)}</div></article>
      <aside className="network-side"><article className="card network-card"><div className="section-heading"><div><h2>Expected policy</h2><p>Destinations permitted for the scanner prototype.</p></div></div><ul className="allowlist">{expectedDestinations.map(([destination, protocol, port, use]) => <li key={destination}><span className="allow-icon">OK</span><span><strong>{destination}</strong><small>{protocol} : {port} - {use}</small></span></li>)}</ul></article><article className="card network-card evidence-card"><span className="eyebrow">Presentation note</span><h2>What this proves</h2><p>This illustrates the review experience: scanner identity, destination, port, protocol, time, and a policy decision. A production implementation still needs container isolation and host-level telemetry collection.</p></article></aside>
    </section>
  </div>;
}
