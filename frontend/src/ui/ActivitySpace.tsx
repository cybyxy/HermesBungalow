export function ActivitySpace() {
  const offices = Array.from({ length: 9 }).map((_, i) => `办公室${i + 1}`);
  const specials = ['休息室', '机房', '资料室', '会议室'];

  return (
    <section className="center panel">
      <div className="panel-title">活动空间</div>
      <div className="rooms-grid">
        {offices.map((name) => (
          <div key={name} className="room-tile">{name}</div>
        ))}
        {specials.map((name) => (
          <div key={name} className="room-tile">{name}</div>
        ))}
      </div>
    </section>
  );
}
