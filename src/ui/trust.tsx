/**
 * "You're in control" diagram: what runs on your computer, what can reach
 * Mimic, and where data goes. Shown in the home page's assistant panel and on
 * the Assistants page. Static unless an assistant is connected, when the local
 * link animates (not with reduced motion).
 */
export function ControlDiagram({ connected, client }: { connected: boolean; client?: string }) {
  const Y = 100; // row centre
  return (
    <figure class="trust-diagram" aria-label="How AI assistants connect to Mimic">
      <svg viewBox="0 0 920 236" role="img" aria-labelledby="trust-title trust-desc">
        <title id="trust-title">Everything runs on your computer</title>
        <desc id="trust-desc">
          Your app and your AI assistant talk to Mimic only on this computer, and you approve each tool your assistant uses. Mimic holds
          no API keys and doesn't contact an AI service. Your assistant has its own connection to its AI service. Other websites can't
          reach Mimic's assistant endpoint.
        </desc>

        {/* the boundary */}
        <rect class="boundary" x="10" y="24" width="642" height="152" rx="14" />
        <text class="boundary-label" x="26" y="46">
          Your computer
        </text>

        {/* links */}
        <path class="t-link" d={`M162,${Y} L232,${Y}`} />
        <path class={`t-link local${connected ? " active" : ""}`} d={`M392,${Y} L430,${Y} M462,${Y} L500,${Y}`} />
        <path class="t-link outbound" d={`M640,${Y} L726,${Y}`} />
        <path class="t-link blocked" d="M310,198 L310,132" />

        {/* link labels */}
        <text class="t-label" x="197" y={Y - 10} text-anchor="middle">
          requests
        </text>
        <text class="t-label" x="446" y={Y - 26} text-anchor="middle">
          local only
        </text>
        <text class="t-label" x="690" y={Y - 10} text-anchor="middle">
          its own
        </text>
        <text class="t-label" x="690" y={Y + 18} text-anchor="middle">
          connection
        </text>

        {/* your app */}
        <g class="t-node">
          <rect x="30" y={Y - 30} width="132" height="60" rx="10" />
          <text class="t-title" x="96" y={Y - 3} text-anchor="middle">
            Your app
          </text>
          <text class="t-sub" x="96" y={Y + 15} text-anchor="middle">
            calls Mimic
          </text>
        </g>

        {/* Mimic */}
        <g class="t-node mimic">
          <rect x="232" y={Y - 32} width="160" height="64" rx="12" />
          <text class="t-title big" x="312" y={Y - 4} text-anchor="middle">
            Mimic
          </text>
          <text class="t-sub" x="312" y={Y + 16} text-anchor="middle">
            no API keys
          </text>
        </g>

        {/* the approval gate */}
        <g class="t-gate">
          <circle cx="446" cy={Y} r="16" />
          <path d={`M439,${Y} l5,5 l9,-10`} />
          <text class="t-label" x="446" y={Y + 34} text-anchor="middle">
            you approve
          </text>
        </g>

        {/* your assistant */}
        <g class={`t-node assistant${connected ? " connected" : ""}`}>
          <rect x="500" y={Y - 30} width="140" height="60" rx="10" />
          <text class="t-title" x="570" y={Y - 3} text-anchor="middle">
            Your AI assistant
          </text>
          <text class="t-sub" x="570" y={Y + 15} text-anchor="middle">
            {connected ? (client ?? "connected").slice(0, 20) : "not connected"}
          </text>
        </g>

        {/* outside: the assistant's AI service */}
        <g class="t-node outside">
          <rect x="726" y={Y - 30} width="180" height="60" rx="10" />
          <text class="t-title" x="816" y={Y - 3} text-anchor="middle">
            AI service
          </text>
          <text class="t-sub" x="816" y={Y + 15} text-anchor="middle">
            your assistant's provider
          </text>
        </g>

        {/* outside: other websites, blocked at the boundary */}
        <g class="t-node outside">
          <rect x="230" y="198" width="160" height="32" rx="8" />
          <text class="t-sub strong" x="310" y="219" text-anchor="middle">
            Other websites
          </text>
        </g>
        <g class="t-block">
          <circle cx="310" cy="176" r="10" />
          <path d="M305,171 l10,10 M315,171 l-10,10" />
        </g>
        <text class="t-label bad" x="328" y="160">
          blocked
        </text>
      </svg>
      <figcaption>
        <span>
          <i class="sw local"></i> on your computer only
        </span>
        <span>
          <i class="sw outbound"></i> your assistant's own connection: what it reads from Mimic goes to its AI service
        </span>
        <span>
          <i class="sw blocked"></i> refused
        </span>
      </figcaption>
    </figure>
  );
}
