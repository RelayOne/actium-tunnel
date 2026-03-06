import { useEffect, useState } from "react";
import { IconShield, IconCheck } from "../App";
import { getAllowedDomains } from "../lib/tauri";

export function AllowlistViewer() {
  const [domains, setDomains] = useState<string[]>([]);

  useEffect(() => {
    getAllowedDomains()
      .then(setDomains)
      .catch((e) => console.error("Failed to load domains:", e));
  }, []);

  return (
    <>
      <div className="main-header">
        <div>
          <div className="main-title">Allowed Domains</div>
          <div className="main-subtitle">
            Traffic is only forwarded to these hosts
          </div>
        </div>
      </div>

      <div className="scroll-area">
        <div className="trust-banner">
          <IconShield />
          <div className="trust-banner-text">
            <strong>This list is compiled into the app binary.</strong>
            The relay server cannot modify it, add hosts, or instruct the app to
            connect to arbitrary destinations. Changing this list requires
            recompiling from source.{" "}
            <a
              href="https://github.com/actium/tunnel"
              target="_blank"
              rel="noopener noreferrer"
            >
              View source &rarr;
            </a>
          </div>
        </div>

        <div className="domain-grid">
          {domains.map((d) => (
            <div key={d} className="domain-row">
              <IconCheck />
              {d}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
