# Recording, history and replay

## History

Every request Mittens answers appears in **History**, newest first: method, path, status, which service and scenario answered, why (`scenario`, `fallback`, `proxy`, `hook`, `unmatched`, `error`), and how long it took. Click a request to see its full headers and bodies. The Services page and each service page show recent requests too.

History keeps the latest 500 requests and bodies up to 256 KB.

## Recording real responses

1. Give a service the real API's URL as its **upstream** and switch it to **proxy** mode.
2. Use your app as normal. Requests pass through to the real API and are recorded.
3. Open a request in History and click **Save as scenario**.

The form comes prefilled with the status, the response headers worth keeping, the body, and a match rule built from the request's path params and query. Review it, adjust the name and match rule, and save. Switch the service back to static or dynamic mode and it answers with your recordings, no network needed.

Responses over 256 KB are truncated in History and can't be saved as scenarios.

## Replaying a request

Click **Replay** on any request in History to send it again: same method, path, query, headers and body, through whatever the services are doing **now**. The new entry says whether the response matches the original, and if not, what changed (status, body, which scenario answered). Handy after switching a mode or editing a scenario.

## Exporting

**Export HAR** and **Export JSON** download what's in History (the service page exports just that service). HAR files open in browser devtools, Charles, Fiddler and similar tools; Mittens's details (which service and scenario answered, validation results) are kept in `_mittens` fields.

## Keeping history across restarts

By default History lives in memory and is gone when Mittens stops. Start with `--persist-history` to also save it to `.mittens/history.jsonl` inside the definitions folder; it's reloaded on start, so you can still replay or save what you recorded yesterday.

That folder gets its own `.gitignore`, because history can contain passwords and tokens from proxied traffic. `--history-file <path>` stores it somewhere else; `--history-limit <n>` changes how many requests are kept. **Clear history** empties the file too.
