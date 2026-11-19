import { useEffect, useMemo, useState } from 'react'
import { settlementOf } from '../data/decode'
import { applyFilters } from '../filters/filter'
import { ENGINE_CREDIT, formatDuration, formatKm, googleDirectionsUrl, type RoadShare, roadShare } from '../route/engine'
import { poisAlongRoute, toGpx } from '../route/geo'
import { CAR_PREFS, planPoints, PROFILE_LABEL, type Profile, ROAD_PREFS, type Role, type Waypoint } from '../route/types'
import { saveTextFile } from '../native/files'
import { locateMe, poiWaypoint } from '../state/actions'
import { useStore } from '../state/store'
import { CategoryIcon } from './CategoryIcon'

const PROFILES: { p: Profile; hint: string }[] = [
  { p: 'hike', hint: 'gyalog; ösvények, földutak és turistautak előnyben' },
  { p: 'bike', hint: 'kerékpárutak és csendes utak előnyben' },
  { p: 'car', hint: 'közúton' },
]

export function RoutePanel({ onPick }: { onPick: (id: string) => void }) {
  const data = useStore((s) => s.data)!
  const filters = useStore((s) => s.filters)
  const route = useStore((s) => s.route)
  const pickRole = useStore((s) => s.pickRole)
  const {
    setProfile,
    setPrefs,
    removeWaypoint,
    moveWaypoint,
    reverseRoute,
    clearRoute,
    setRouteResult,
    setPickRole,
    addWaypoint,
  } = useStore.getState()
  const [locError, setLocError] = useState<string | null>(null)
  const [share, setShare] = useState<RoadShare | null>(null)
  const { plan, profile, prefs, alts, active, status, error } = route
  const alt = alts[active]
  const pts = planPoints(plan)

  // Az út mentén a kategória-, fontosság- és jelzőszűrők számítanak; a keresőszó és a
  // vármegye nem (a célt gyakran kereséssel választják, és az út több megyén is átmehet).
  const candidates = useMemo(
    () => applyFilters(data.index, { ...filters, q: '', counties: [] }).indices,
    [data.index, filters],
  )
  const nearby = useMemo(
    () => (alt ? poisAlongRoute(data.index, candidates, alt.coords, 300, 40) : []),
    [alt, data.index, candidates],
  )

  // mennyi az aktív változatból a közút (kiegészítő adat; hibánál nem jelenik meg)
  useEffect(() => {
    setShare(null)
    if (!alt || alt.engine !== 'valhalla' || profile === 'car') return
    const c = new AbortController()
    void roadShare(alt.coords, profile, c.signal).then((r) => !c.signal.aborted && setShare(r))
    return () => c.abort()
  }, [alt, profile])

  const useMyLocation = (role: Role) => {
    setLocError(null)
    locateMe()
      .then((me) => addWaypoint(me, role))
      .catch((e: Error) => setLocError(e.message))
  }

  const downloadGpx = () => {
    if (!alt || !pts) return
    const name = `${pts[0].name} – ${pts[pts.length - 1].name}`
    void saveTextFile(`utvonal-${new Date().toISOString().slice(0, 10)}.gpx`, toGpx(name, alt.coords, pts), 'application/gpx+xml')
  }

  return (
    <section className="route" data-testid="route-panel" aria-label="Útvonaltervezés">
      <div className="chips profiles" role="radiogroup" aria-label="Közlekedési mód">
        {PROFILES.map(({ p, hint }) => (
          <button
            key={p}
            type="button"
            role="radio"
            aria-checked={profile === p}
            className={`chip tier${profile === p ? ' on' : ''}`}
            title={hint}
            onClick={() => setProfile(p)}
            data-testid={`profile-${p}`}
          >
            {PROFILE_LABEL[p]}
          </button>
        ))}
      </div>

      <div className="chips prefs" role="radiogroup" aria-label="Útválasztás">
        {(profile === 'car' ? CAR_PREFS : ROAD_PREFS).map(({ v, label, hint }) => {
          const on = profile === 'car' ? prefs.car === v : prefs.road === v
          return (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={on}
              className={`chip tier small-chip${on ? ' on' : ''}`}
              title={hint}
              onClick={() => (profile === 'car' ? setPrefs({ car: v as typeof prefs.car }) : setPrefs({ road: v as typeof prefs.road }))}
              data-testid={`pref-${v}`}
            >
              {label}
            </button>
          )
        })}
      </div>
      {profile !== 'car' && prefs.road === 'avoid' && (
        <p className="hint">Ahol nincs más összeköttetés, rövid közúti szakasz előfordulhat.</p>
      )}

      <ol className="route-points">
        <PointRow
          role="start"
          label="I"
          wp={plan.start}
          empty="Indulás"
          picking={pickRole === 'start'}
          onRemove={() => removeWaypoint('start')}
          onMe={() => useMyLocation('start')}
          onPick={() => setPickRole('start')}
        />
        {plan.vias.map((v, i) => (
          <PointRow
            key={`${v.lat},${v.lon},${i}`}
            role="via"
            label={String(i + 1)}
            wp={v}
            empty=""
            onRemove={() => removeWaypoint('via', i)}
            onUp={i > 0 ? () => moveWaypoint(i, -1) : undefined}
            onDown={i < plan.vias.length - 1 ? () => moveWaypoint(i, 1) : undefined}
          />
        ))}
        <PointRow
          role="end"
          label="C"
          wp={plan.end}
          empty="Cél"
          picking={pickRole === 'end'}
          onRemove={() => removeWaypoint('end')}
          onMe={() => useMyLocation('end')}
          onPick={() => setPickRole('end')}
        />
      </ol>
      <div className="route-tools">
        <button type="button" className="link-btn" onClick={() => setPickRole('via')} disabled={!plan.end}>
          + Köztes pont a térképről
        </button>
        <button type="button" className="link-btn" onClick={reverseRoute} disabled={!plan.start && !plan.end}>
          ⇅ Megfordítás
        </button>
        <button type="button" className="link-btn" onClick={clearRoute} disabled={!plan.start && !plan.end && !plan.vias.length}>
          Törlés
        </button>
      </div>
      {locError && <p className="hint warn-text">{locError}</p>}
      {!pts && (
        <p className="hint">
          Válassz célt: koppints egy látnivalóra, majd „Útvonal ide”. A térképen hosszan nyomva (egérrel jobb
          kattintással) bármely pont lehet indulás, köztes pont vagy cél.
        </p>
      )}

      {status === 'loading' && (
        <p className="route-status" role="status">
          <span className="spinner small" /> Útvonal tervezése…
        </p>
      )}
      {status === 'error' && (
        <div className="notice" role="alert">
          {error}
          {pts && (
            <>
              {' '}
              <a href={googleDirectionsUrl(pts, profile)} target="_blank" rel="noreferrer">
                Megnyitás Google Térképen
              </a>
            </>
          )}
        </div>
      )}

      {alt && pts && (
        <>
          <div className="alts" role="radiogroup" aria-label="Útvonal-változatok" data-testid="route-alts">
            {alts.map((a, i) => (
              <button
                key={i}
                type="button"
                role="radio"
                aria-checked={i === active}
                className={`alt${i === active ? ' on' : ''}`}
                onClick={() => setRouteResult({ active: i })}
                data-testid="route-alt"
              >
                <strong>{formatKm(a.distanceKm)}</strong>
                <span>{formatDuration(a.durationS)}</span>
                {a.ascent !== undefined && (
                  <span title="szintemelkedés / lejtés">
                    ↑ {a.ascent} m · ↓ {a.descent} m
                  </span>
                )}
                {alts.length > 1 && <small>{i === 0 ? 'Javasolt' : `${i + 1}. változat`}</small>}
              </button>
            ))}
          </div>

          {share && share.totalKm > 0 && (
            <p className="road-share" data-testid="road-share">
              Közúton: {formatKm(share.roadKm)} ({Math.round((100 * share.roadKm) / share.totalKm)}%)
              {share.busyKm > 0.05 ? `, ebből forgalmas út: ${formatKm(share.busyKm)}` : ''}
            </p>
          )}
          {alt.engine === 'osrm' && (
            <p className="hint">A tartalék tervező (OSRM) az útválasztási beállítást nem tudja figyelembe venni.</p>
          )}

          <div className="actions">
            <button type="button" className="btn" onClick={downloadGpx} data-testid="gpx">
              GPX letöltése
            </button>
            <a className="btn secondary" href={googleDirectionsUrl(pts, profile)} target="_blank" rel="noreferrer">
              Google Térképen
            </a>
          </div>

          <section className="along" data-testid="along">
            <h3>Látnivalók az út mentén ({nearby.length})</h3>
            {nearby.length === 0 ? (
              <p className="hint">300 m-en belül nincs a kategória- és fontosság-szűrőknek megfelelő látnivaló.</p>
            ) : (
              <ul>
                {nearby.map(({ i, d }) => {
                  const id = data.index.id[i]
                  const cat = data.meta.categories[data.index.cats[data.index.cat[i]]]
                  const settlement = settlementOf(data.index, i)
                  const inPlan = [plan.start, ...plan.vias, plan.end].some((w) => w?.poiId === id)
                  return (
                    <li key={id}>
                      <button type="button" className="along-name" onClick={() => onPick(id)}>
                        <CategoryIcon cat={cat} size={22} />
                        <span>
                          <span className="result-name">{data.index.name[i]}</span>
                          <span className="result-sub">
                            {cat.label}
                            {settlement ? ` · ${settlement}` : ''} · {Math.round(d)} m
                          </span>
                        </span>
                      </button>
                      {!inPlan && (
                        <button
                          type="button"
                          className="btn secondary small"
                          onClick={() => {
                            const w = poiWaypoint(id)
                            if (w) addWaypoint(w, 'via')
                          }}
                          aria-label={`${data.index.name[i]} útba ejtése`}
                        >
                          + Útba
                        </button>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </section>

          {alt.steps.length > 0 && (
            <details className="steps">
              <summary>Útleírás ({alt.steps.length} lépés)</summary>
              <ol>
                {alt.steps.map((s, i) => (
                  <li key={i}>
                    {s.text}
                    {s.km > 0 && <span className="hint"> – {formatKm(s.km)}</span>}
                  </li>
                ))}
              </ol>
            </details>
          )}
          <p className="hint credit">{ENGINE_CREDIT[alt.engine]}</p>
        </>
      )}
    </section>
  )
}

function PointRow({
  role,
  label,
  wp,
  empty,
  picking,
  onRemove,
  onMe,
  onPick,
  onUp,
  onDown,
}: {
  role: Role
  label: string
  wp: Waypoint | null
  empty: string
  picking?: boolean
  onRemove: () => void
  onMe?: () => void
  onPick?: () => void
  onUp?: () => void
  onDown?: () => void
}) {
  return (
    <li className={`route-point ${role}`} data-testid={`route-${role}`}>
      <span className="pt-badge" aria-hidden="true">
        {label}
      </span>
      {wp ? (
        <>
          <span className="pt-name">{wp.name}</span>
          {onUp && (
            <button type="button" className="icon-btn" onClick={onUp} aria-label="Feljebb">
              ↑
            </button>
          )}
          {onDown && (
            <button type="button" className="icon-btn" onClick={onDown} aria-label="Lejjebb">
              ↓
            </button>
          )}
          <button type="button" className="icon-btn" onClick={onRemove} aria-label={`${wp.name} törlése`}>
            ✕
          </button>
        </>
      ) : (
        <>
          <span className="pt-name empty">{picking ? 'Koppints a térképre…' : empty}</span>
          {onMe && (
            <button type="button" className="btn secondary small" onClick={onMe}>
              Saját helyem
            </button>
          )}
          {onPick && (
            <button type="button" className="btn secondary small" onClick={onPick} data-testid={`pick-${role}`}>
              Térképről
            </button>
          )}
        </>
      )}
    </li>
  )
}
