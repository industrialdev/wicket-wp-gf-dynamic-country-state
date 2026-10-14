# Wicket GF Dynamic Country State

Populates Gravity Forms address State/Province dropdowns client-side. A single batched admin-ajax call prefetches divisions for every country in the form's selects, caches them in a transient, and the State select rebuilds instantly on country change with no network request. A loading overlay with a failsafe covers the cold path.

## Behavior

- **Batched prefetch** — one nonce-guarded `get_all_states_for_countries` admin-ajax request (public + logged-out) fetches all divisions; cached in the `gf_all_states_cache` transient for one week.
- **Instant country change** — the State select rebuilds from the local cache; no per-change fetch.
- **Failsafe** — any address container stuck loading for more than 3 seconds force-clears; containers are never permanently stuck.
- **Multi-step persistence** — state values persist across multi-page forms via hidden `backup_` inputs; writes converge (no re-announcement event loops).
- **States cache is lazy** — the multi-megabyte transient is not loaded on every request, only when a state lookup needs it.

## Requirements

- WordPress 6.0+
- Gravity Forms 2.7+
- PHP 8.2+
- [rinvex/countries](https://github.com/rinvex/countries) (division data source)

## Provenance

Forked from `gf-address-state-dropdowns`. The fixes for WWID-2777 (stuck country-change spinner) are the first stack-side commits.

## Debugging

Set `localStorage.setItem('gfasDebug', '1')` and reload: `showLoading` calls log their stack, and failsafe interventions are logged. Remove the key to turn it off.
