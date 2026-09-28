import { useState, useEffect, useCallback } from "react";

// ── Weather condition codes from Open-Meteo API ──────────────────────
// Each code maps to a label and emoji icon
const WMO_CODES = {
  0: { label: "Clear Sky", icon: "☀️" },
  1: { label: "Mainly Clear", icon: "🌤️" },
  2: { label: "Partly Cloudy", icon: "⛅" },
  3: { label: "Overcast", icon: "☁️" },
  45: { label: "Foggy", icon: "🌫️" },
  48: { label: "Icy Fog", icon: "🌫️" },
  51: { label: "Light Drizzle", icon: "🌦️" },
  53: { label: "Drizzle", icon: "🌦️" },
  55: { label: "Heavy Drizzle", icon: "🌧️" },
  61: { label: "Light Rain", icon: "🌧️" },
  63: { label: "Rain", icon: "🌧️" },
  65: { label: "Heavy Rain", icon: "🌧️" },
  71: { label: "Light Snow", icon: "🌨️" },
  73: { label: "Snow", icon: "❄️" },
  75: { label: "Heavy Snow", icon: "❄️" },
  80: { label: "Rain Showers", icon: "🌦️" },
  81: { label: "Showers", icon: "🌧️" },
  82: { label: "Violent Showers", icon: "⛈️" },
  95: { label: "Thunderstorm", icon: "⛈️" },
  96: { label: "Hail Storm", icon: "⛈️" },
  99: { label: "Heavy Hail", icon: "⛈️" },
};

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// Helper: get label + icon from weather code
function getWeatherInfo(code) {
  return WMO_CODES[code] || { label: "Unknown", icon: "🌡️" };
}

// ── API CALL 1: Convert city name → latitude/longitude ────────────────
async function geocode(city) {
  const res = await fetch(
    `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=en&format=json`
  );
  const data = await res.json();
  if (!data.results?.length) throw new Error("City not found");
  return data.results[0];
}

// ── API CALL 2: Fetch weather data using lat/lon ──────────────────────
// We request:
//   current  → right now conditions
//   hourly   → temperature every hour for 7 days
//   daily    → summary for each of 7 days
async function fetchWeather(lat, lon) {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    `&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,weather_code` +
    `&hourly=temperature_2m` +
    `&daily=weather_code,temperature_2m_max,temperature_2m_min` +
    `&timezone=auto&forecast_days=7`;
  const res = await fetch(url);
  return res.json();
}

// ── Hourly Line Chart drawn with SVG (no chart library needed) ────────
// SVG = a way to draw shapes directly in the browser using code
function HourlyChart({ hourlyTime, hourlyTemp, selectedDate, unit }) {
  const toF = (c) => Math.round(c * 9 / 5 + 32);
  const display = (c) => unit === "C" ? Math.round(c) : toF(c);

  // Filter only the 24 hours that belong to the selected day
  const indices = hourlyTime
    .map((t, i) => ({ t, i }))
    .filter(({ t }) => t.startsWith(selectedDate))
    .map(({ i }) => i);

  const temps = indices.map((i) => display(hourlyTemp[i]));
  const times = indices.map((i) => {
    const h = new Date(hourlyTime[i]).getHours();
    if (h === 0) return "12am";
    if (h === 12) return "12pm";
    return h < 12 ? `${h}am` : `${h - 12}pm`;
  });

  // SVG canvas size and padding
  const W = 700, H = 120;
  const PAD = { top: 20, bottom: 28, left: 10, right: 10 };
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;

  const minT = Math.min(...temps) - 1;
  const maxT = Math.max(...temps) + 1;

  // Convert data index → X pixel position
  const xOf = (i) => PAD.left + (i / (temps.length - 1)) * innerW;
  // Convert temperature → Y pixel position (higher temp = lower Y number = higher on screen)
  const yOf = (t) => PAD.top + innerH - ((t - minT) / (maxT - minT)) * innerH;

  // The line: a series of X,Y points joined together
  const points = temps.map((t, i) => `${xOf(i)},${yOf(t)}`).join(" ");

  // The filled area under the line (a closed shape)
  const areaPath =
    `M ${xOf(0)},${yOf(temps[0])} ` +
    temps.map((t, i) => `L ${xOf(i)},${yOf(t)}`).join(" ") +
    ` L ${xOf(temps.length - 1)},${H - PAD.bottom} L ${xOf(0)},${H - PAD.bottom} Z`;

  // Dot position: current hour for today, noon for other days
  const today = new Date().toISOString().slice(0, 10);
  const dotIdx = selectedDate === today
    ? Math.min(new Date().getHours(), temps.length - 1)
    : 12;

  // Only show time labels every 3 hours so they don't overlap
  const labelIndices = temps.map((_, i) => i).filter((i) => i % 3 === 0);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", overflow: "visible" }}>
      <defs>
        {/* Blue gradient fill under the line */}
        <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#63b3ed" stopOpacity="0.22" />
          <stop offset="100%" stopColor="#63b3ed" stopOpacity="0" />
        </linearGradient>
        {/* Glow effect for the dot */}
        <filter id="glow">
          <feGaussianBlur stdDeviation="2.5" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>

      {/* Subtle horizontal grid lines */}
      {[0, 0.5, 1].map((frac, i) => (
        <line key={i}
          x1={PAD.left} y1={PAD.top + innerH * (1 - frac)}
          x2={W - PAD.right} y2={PAD.top + innerH * (1 - frac)}
          stroke="rgba(255,255,255,0.05)" strokeWidth="1"
        />
      ))}

      {/* Filled area under curve */}
      <path d={areaPath} fill="url(#areaGrad)" />

      {/* The temperature line */}
      <polyline points={points} fill="none" stroke="#63b3ed"
        strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />

      {/* Time labels along bottom (every 3 hours) */}
      {labelIndices.map((i) => (
        <text key={i} x={xOf(i)} y={H - 6}
          textAnchor="middle" fontSize="9"
          fill="rgba(232,228,220,0.3)" fontFamily="DM Mono, monospace">
          {times[i]}
        </text>
      ))}

      {/* Temperature labels above line (every 3 hours) */}
      {labelIndices.map((i) => (
        <text key={`t${i}`} x={xOf(i)} y={yOf(temps[i]) - 6}
          textAnchor="middle" fontSize="9"
          fill="rgba(232,228,220,0.45)" fontFamily="DM Mono, monospace">
          {temps[i]}°
        </text>
      ))}

      {/* Glowing dot at current hour (or noon for other days) */}
      <circle cx={xOf(dotIdx)} cy={yOf(temps[dotIdx])}
        r="5" fill="#63b3ed" filter="url(#glow)" />
      <circle cx={xOf(dotIdx)} cy={yOf(temps[dotIdx])}
        r="3" fill="#fff" />
    </svg>
  );
}

// ── CSS styles written as a JS string (so we can keep everything in 1 file) ──
const styles = `
  @import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Plus+Jakarta+Sans:ital,wght@0,200..800;1,200..800&display=swap');
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Syne', sans-serif; background: #0a0a0f; color: #e8e4dc; min-height: 100vh; }

  .app { min-height: 100vh; background: #0a0a0f; display: flex; flex-direction: column; align-items: center; padding: 2rem 1rem 4rem; position: relative; overflow: hidden; }
  .app::before { content: ''; position: fixed; inset: 0; background: radial-gradient(ellipse 80% 60% at 20% -10%, rgba(99,179,237,0.08) 0%, transparent 60%), radial-gradient(ellipse 60% 50% at 80% 100%, rgba(237,137,54,0.06) 0%, transparent 60%); pointer-events: none; z-index: 0; }
  .content { position: relative; z-index: 1; width: 100%; max-width: 760px; }

  .top-row { display: flex; align-items: center; margin-bottom: 2.5rem; }
  .logo { font-size: 1.1rem; font-weight: 800; letter-spacing: 0.2em; text-transform: uppercase; color: #63b3ed; }
  .logo-dot { color: #ed8936; }
  .unit-toggle { display: flex; gap: 0.5rem; margin-left: auto; }
  .unit-btn { background: none; border: 1px solid rgba(255,255,255,0.12); border-radius: 8px; padding: 0.3rem 0.7rem; color: rgba(232,228,220,0.4); font-family: 'DM Mono', monospace; font-size: 0.8rem; cursor: pointer; transition: all 0.2s; }
  .unit-btn.active { background: rgba(99,179,237,0.15); border-color: #63b3ed; color: #63b3ed; }

  .search-row { display: flex; gap: 0.75rem; margin-bottom: 2.5rem; }
  .search-input { flex: 1; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.1); border-radius: 12px; padding: 0.85rem 1.25rem; color: #e8e4dc; font-family: 'DM Mono', monospace; font-size: 0.95rem; outline: none; transition: border-color 0.2s, background 0.2s; }
  .search-input::placeholder { color: rgba(232,228,220,0.3); }
  .search-input:focus { border-color: #63b3ed; background: rgba(99,179,237,0.06); }
  .search-btn { background: #63b3ed; color: #0a0a0f; border: none; border-radius: 12px; padding: 0.85rem 1.5rem; font-family: 'Syne', sans-serif; font-weight: 700; font-size: 0.9rem; cursor: pointer; transition: background 0.2s, transform 0.1s; white-space: nowrap; }
  .search-btn:hover { background: #90cdf4; }
  .search-btn:active { transform: scale(0.97); }
  .search-btn:disabled { opacity: 0.5; cursor: not-allowed; }

  .error-msg { background: rgba(245,101,101,0.1); border: 1px solid rgba(245,101,101,0.3); color: #fc8181; border-radius: 10px; padding: 0.75rem 1.25rem; font-family: 'DM Mono', monospace; font-size: 0.85rem; margin-bottom: 1.5rem; }

  .skeleton { background: linear-gradient(90deg, rgba(255,255,255,0.04) 25%, rgba(255,255,255,0.08) 50%, rgba(255,255,255,0.04) 75%); background-size: 200% 100%; animation: shimmer 1.4s infinite; border-radius: 12px; }
  @keyframes shimmer { to { background-position: -200% 0; } }
  .skeleton-card { height: 220px; margin-bottom: 1.5rem; }
  .skeleton-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 0.75rem; margin-bottom: 1.5rem; }
  .skeleton-small { height: 90px; }

  .current-card { background: rgba(255,255,255,0.035); border: 1px solid rgba(255,255,255,0.08); border-radius: 20px; padding: 2rem 2rem 1.75rem; margin-bottom: 1.25rem; position: relative; overflow: hidden; animation: fadeUp 0.5s ease both; }
  .current-card::after { content: ''; position: absolute; top: -60px; right: -60px; width: 200px; height: 200px; background: radial-gradient(circle, rgba(99,179,237,0.07) 0%, transparent 70%); pointer-events: none; }
  @keyframes fadeUp { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: translateY(0); } }

  .city-name { font-size: 1.05rem; font-weight: 600; letter-spacing: 0.12em; text-transform: uppercase; color: rgba(232,228,220,0.5); margin-bottom: 0.25rem; font-family: 'DM Mono', monospace; }
  .country-name { font-size: 0.78rem; color: rgba(232,228,220,0.25); font-family: 'DM Mono', monospace; margin-bottom: 1.5rem; }
  .temp-row { display: flex; align-items: flex-start; gap: 1rem; margin-bottom: 1rem; }
  .temp-big { font-size: clamp(3.5rem, 10vw, 5.5rem); font-weight: 800; line-height: 1; letter-spacing: -0.03em; color: #e8e4dc; }
  .temp-unit { font-size: 1.5rem; font-weight: 400; color: rgba(232,228,220,0.4); margin-top: 0.6rem; }
  .weather-icon-big { font-size: 3.5rem; margin-top: 0.4rem; }
  .weather-label { font-size: 1rem; color: rgba(232,228,220,0.55); font-weight: 500; margin-bottom: 1.5rem; }
  .stats-row { display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.75rem; border-top: 1px solid rgba(255,255,255,0.06); padding-top: 1.25rem; }
  .stat { display: flex; flex-direction: column; gap: 0.2rem; }
  .stat-label { font-size: 0.7rem; letter-spacing: 0.12em; text-transform: uppercase; color: rgba(232,228,220,0.3); font-family: 'DM Mono', monospace; }
  .stat-value { font-size: 1rem; font-weight: 600; color: #e8e4dc; font-family: 'DM Mono', monospace; }

  .section-title { font-size: 0.7rem; letter-spacing: 0.18em; text-transform: uppercase; color: rgba(232,228,220,0.3); font-family: 'DM Mono', monospace; margin-bottom: 0.75rem; padding-left: 0.25rem; }

  /* Chart card */
  .chart-card { background: rgba(255,255,255,0.025); border: 1px solid rgba(255,255,255,0.07); border-radius: 18px; padding: 1.25rem 1.5rem 1rem; margin-bottom: 1.5rem; animation: fadeUp 0.4s ease both; }
  .chart-title-row { display: flex; align-items: center; justify-content: space-between; margin-bottom: 1rem; }
  .chart-day-label { font-size: 0.75rem; color: #63b3ed; font-family: 'DM Mono', monospace; font-weight: 500; }

  /* 7-day forecast grid */
  .forecast-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 0.5rem; margin-bottom: 1.5rem; }
  @media (max-width: 600px) { .forecast-grid { grid-template-columns: repeat(4, 1fr); } .stats-row { grid-template-columns: repeat(2, 1fr); } }

  /* Each day card — clickable */
  .forecast-day { background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06); border-radius: 14px; padding: 0.85rem 0.5rem; display: flex; flex-direction: column; align-items: center; gap: 0.4rem; cursor: pointer; transition: background 0.2s, border-color 0.2s, transform 0.15s; animation: fadeUp 0.5s ease both; }
  .forecast-day:hover { background: rgba(99,179,237,0.07); border-color: rgba(99,179,237,0.2); transform: translateY(-2px); }
  /* Selected day gets highlighted border */
  .forecast-day.selected { background: rgba(99,179,237,0.12); border-color: #63b3ed; }
  .forecast-day-name { font-size: 0.65rem; letter-spacing: 0.1em; text-transform: uppercase; color: rgba(232,228,220,0.4); font-family: 'DM Mono', monospace; }
  .forecast-icon { font-size: 1.4rem; }
  .forecast-max { font-size: 0.9rem; font-weight: 700; color: #e8e4dc; }
  .forecast-min { font-size: 0.75rem; color: rgba(232,228,220,0.35); font-family: 'DM Mono', monospace; }

  .footer { margin-top: 2rem; text-align: center; font-family: 'DM Mono', monospace; font-size: 0.7rem; color: rgba(232,228,220,0.15); letter-spacing: 0.08em; }
  .footer span { color: #63b3ed; opacity: 0.5; }
  .loading-spinner { display: inline-block; width: 14px; height: 14px; border: 2px solid rgba(10,10,15,0.3); border-top-color: #0a0a0f; border-radius: 50%; animation: spin 0.7s linear infinite; margin-right: 6px; }
  @keyframes spin { to { transform: rotate(360deg); } }
`;

// ── Main App Component ─────────────────────────────────────────────────
export default function WeatherApp() {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [weather, setWeather] = useState(null);
  const [location, setLocation] = useState(null);
  const [unit, setUnit] = useState("C");

  // selectedDate controls which day's chart is shown
  // Starts as today's date string e.g. "2025-01-10"
  const [selectedDate, setSelectedDate] = useState(
    new Date().toISOString().slice(0, 10)
  );

  const toF = (c) => Math.round(c * 9 / 5 + 32);
  const displayTemp = (c) => unit === "C" ? `${Math.round(c)}` : `${toF(c)}`;

  // Search function: geocode the city, then fetch weather
  const search = useCallback(async (cityName) => {
    if (!cityName.trim()) return;
    setLoading(true);
    setError("");
    try {
      const loc = await geocode(cityName);
      const data = await fetchWeather(loc.latitude, loc.longitude);
      setLocation(loc);
      setWeather(data);
      // Reset chart to today when new city is searched
      setSelectedDate(new Date().toISOString().slice(0, 10));
    } catch (e) {
      setError(e.message || "Something went wrong. Try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  const handleKey = (e) => { if (e.key === "Enter") search(query); };

  // Load Mumbai by default when app first opens
  useEffect(() => { search("Mumbai"); }, []);

  const cur = weather?.current;
  const daily = weather?.daily;
  const hourly = weather?.hourly;

  // Get a nice label for the chart title e.g. "Today" or "Sat, Jul 12"
  const todayStr = new Date().toISOString().slice(0, 10);
  const selectedDay = new Date(selectedDate);
  const chartLabel = selectedDate === todayStr
    ? "Today"
    : `${DAYS[selectedDay.getDay()]}, ${selectedDay.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;

  return (
    <>
      <style>{styles}</style>
      <div className="app">
        <div className="content">

          {/* Logo + °C/°F toggle */}
          <div className="top-row">
            <span className="logo">VAYU<span className="logo-dot">.</span></span>
            <div className="unit-toggle">
              <button className={`unit-btn ${unit === "C" ? "active" : ""}`} onClick={() => setUnit("C")}>°C</button>
              <button className={`unit-btn ${unit === "F" ? "active" : ""}`} onClick={() => setUnit("F")}>°F</button>
            </div>
          </div>

          {/* Search bar */}
          <div className="search-row">
            <input
              className="search-input"
              placeholder="Search any city worldwide..."
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={handleKey}
            />
            <button className="search-btn" onClick={() => search(query)} disabled={loading}>
              {loading ? <><span className="loading-spinner" />Finding</> : "Search"}
            </button>
          </div>

          {/* Error message */}
          {error && <div className="error-msg">⚠ {error}</div>}

          {/* Loading skeleton shown while data is being fetched */}
          {loading && !weather && (
            <>
              <div className="skeleton skeleton-card" />
              <div className="skeleton-row">
                {[...Array(4)].map((_, i) => <div key={i} className="skeleton skeleton-small" />)}
              </div>
            </>
          )}

          {/* Main weather content — shown only when data is ready */}
          {weather && cur && !loading && (
            <>
              {/* ── Current conditions card ── */}
              <div className="current-card">
                <div className="city-name">{location?.name}</div>
                <div className="country-name">
                  {location?.admin1 && `${location.admin1}, `}{location?.country}
                </div>
                <div className="temp-row">
                  <div className="temp-big">{displayTemp(cur.temperature_2m)}</div>
                  <div className="temp-unit">°{unit}</div>
                  <div style={{ flex: 1 }} />
                  <div className="weather-icon-big">{getWeatherInfo(cur.weather_code).icon}</div>
                </div>
                <div className="weather-label">{getWeatherInfo(cur.weather_code).label}</div>
                <div className="stats-row">
                  <div className="stat">
                    <span className="stat-label">Feels Like</span>
                    <span className="stat-value">{displayTemp(cur.apparent_temperature)}°</span>
                  </div>
                  <div className="stat">
                    <span className="stat-label">Humidity</span>
                    <span className="stat-value">{cur.relative_humidity_2m}%</span>
                  </div>
                  <div className="stat">
                    <span className="stat-label">Wind</span>
                    <span className="stat-value">{Math.round(cur.wind_speed_10m)} km/h</span>
                  </div>
                </div>
              </div>

              {/* ── 7-day forecast ── click any day to see its hourly chart ── */}
              <div className="section-title">7-Day Forecast — tap a day to see its chart</div>
              <div className="forecast-grid">
                {daily.time.map((dateStr, i) => {
                  const info = getWeatherInfo(daily.weather_code[i]);
                  const isSelected = dateStr === selectedDate;
                  return (
                    <div
                      key={dateStr}
                      className={`forecast-day ${isSelected ? "selected" : ""}`}
                      onClick={() => setSelectedDate(dateStr)}  // clicking sets selected date
                    >
                      <div className="forecast-day-name">
                        {i === 0 ? "Today" : DAYS[new Date(dateStr).getDay()]}
                      </div>
                      <div className="forecast-icon">{info.icon}</div>
                      <div className="forecast-max">{displayTemp(daily.temperature_2m_max[i])}°</div>
                      <div className="forecast-min">{displayTemp(daily.temperature_2m_min[i])}°</div>
                    </div>
                  );
                })}
              </div>

              {/* ── Hourly temperature chart for the selected day ── */}
              {hourly && (
                <div className="chart-card">
                  <div className="chart-title-row">
                    <div className="section-title" style={{ marginBottom: 0 }}>
                      Hourly Temperature
                    </div>
                    <div className="chart-day-label">{chartLabel}</div>
                  </div>
                  <HourlyChart
                    hourlyTime={hourly.time}
                    hourlyTemp={hourly.temperature_2m}
                    selectedDate={selectedDate}
                    unit={unit}
                  />
                </div>
              )}
            </>
          )}

          <div className="footer">
            Powered by <span>Open-Meteo</span> · Free & Open Source Weather API
          </div>
        </div>
      </div>
    </>
  );
}