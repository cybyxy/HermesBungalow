import { useGameState } from '../store/gameState';

export function ActivityFeed() {
  const events = useGameState((s) => s.events);
  const activityLog = useGameState((s) => s.activityLog);

  return (
    <section className="panel">
      <div className="panel-title">活动提示</div>
      <div className="event-list">
        {events.length === 0 ? <div className="muted">暂无事件</div> : events.slice(0, 6).map((e) => (
          <div key={e.id} className={`event-item ${e.type}`}>
            <div>{e.title}</div>
            <small>{e.detail}</small>
          </div>
        ))}
      </div>
      <div className="panel-title" style={{ marginTop: 10 }}>日志</div>
      <div className="log-list">
        {activityLog.length === 0 ? <div className="muted">暂无日志</div> : activityLog.slice(0, 6).map((line, idx) => (
          <div key={`${line.timestamp}-${idx}`} className="log-item">[{line.type}] {line.message}</div>
        ))}
      </div>
    </section>
  );
}
