import { Clock3, MapPin, ThermometerSun } from "lucide-react";

import { cToF, formatTimestamp } from "./planWorkspace.js";
import "./DecisionComparisonStrip.css";

function f(value) {
  const result = cToF(value);
  return result === null ? "--" : `${result}°F`;
}

function delta(value, current) {
  const next = Number(value);
  const now = Number(current);
  if (!Number.isFinite(next) || !Number.isFinite(now)) return "comparison unavailable";
  const changeF = Math.round(((next - now) * 9) / 5 * 10) / 10;
  if (changeF === 0) return "same sampled temperature";
  return `${changeF > 0 ? "+" : ""}${changeF}°F vs current`;
}

export default function DecisionComparisonStrip({ currentTemp, bestFuture, selectedCandidate, site }) {
  return (
    <div className="hs-decision-compare-strip">
      <article className="current">
        <ThermometerSun size={19} />
        <div>
          <span>CURRENT</span>
          <strong>{f(currentTemp)}</strong>
          <small>worker tile now</small>
        </div>
      </article>

      <article className={bestFuture ? "candidate" : "muted"}>
        <Clock3 size={19} />
        <div>
          <span>BETTER TIME</span>
          <strong>{bestFuture ? f(bestFuture.temperature_c) : "--"}</strong>
          <small>
            {bestFuture
              ? `${formatTimestamp(bestFuture.requested_local_timestamp, site?.timezone)} · ${delta(bestFuture.temperature_c, currentTemp)}`
              : "no future provider sample"}
          </small>
        </div>
      </article>

      <article className={selectedCandidate ? "candidate" : "muted"}>
        <MapPin size={19} />
        <div>
          <span>BETTER PLACE</span>
          <strong>{selectedCandidate ? f(selectedCandidate.temperature_c) : "--"}</strong>
          <small>
            {selectedCandidate
              ? `#${selectedCandidate.rank} · ${Math.round(selectedCandidate.straight_line_distance_m)} m · ${delta(selectedCandidate.temperature_c, currentTemp)}`
              : "run site scan and select a candidate"}
          </small>
        </div>
      </article>
    </div>
  );
}
