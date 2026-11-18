import { useEffect, useMemo, useState } from 'react'
import type { Dataset, Hub, Match, Player } from './domain'
import { useAdminAuth } from './AuthGate'
import {
  cancelMatch as cancelMatchApi,
  completeMatch as completeMatchApi,
  createHub as createHubApi,
  createMatch as createMatchApi,
  createPlayer as createPlayerApi,
  fetchAdminDataset,
  getYouTubeVideoId,
  updatePlayer as updatePlayerApi,
} from './api'
import { createAdminBackup, createPublicDataset, downloadFile } from './transfers'

type Section = 'overview' | 'players' | 'matches'
type Dialog = 'hub' | 'player' | 'match' | null

function App() {
  const { user, signOut } = useAdminAuth()
  const [dataset, setDataset] = useState<Dataset>({ version: 1, hubs: [], players: [], matches: [] })
  const [hubId, setHubId] = useState('')
  const [section, setSection] = useState<Section>('overview')
  const [exportToolsOpen, setExportToolsOpen] = useState(false)
  const [dialog, setDialog] = useState<Dialog>(null)
  const [editingPlayer, setEditingPlayer] = useState<Player | null>(null)
  const [search, setSearch] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const [startupError, setStartupError] = useState('')

  function handleSignOut() {
    void signOut().catch((cause: unknown) => setError(errorMessage(cause)))
  }

  useEffect(() => {
    let active = true
    fetchAdminDataset()
      .then((loaded) => {
        if (!active) return
        setDataset(loaded)
        setHubId(loaded.hubs.find((hub) => hub.isActive)?.id ?? '')
        setStartupError('')
      })
      .catch((cause: unknown) => {
        if (active) setStartupError(errorMessage(cause))
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    setExportToolsOpen(false)
  }, [section])

  const activeHub = dataset.hubs.find((hub) => hub.id === hubId)
  const hubPlayers = useMemo(
    () => dataset.players.filter((player) => player.hubId === hubId),
    [dataset.players, hubId],
  )
  const activePlayers = hubPlayers.filter((player) => player.isActive)
  const hubMatches = useMemo(
    () => dataset.matches
      .filter((match) => match.hubId === hubId)
      .sort((left, right) => right.playedAt.localeCompare(left.playedAt)),
    [dataset.matches, hubId],
  )
  const scheduled = hubMatches.filter((match) => match.status === 'Scheduled')
  const rankedPlayers = [...activePlayers].sort(
    (left, right) =>
      right.currentMMR - left.currentMMR ||
      left.displayName.localeCompare(right.displayName),
  )
  const directoryPlayers = [...hubPlayers].sort(
    (left, right) =>
      Number(right.isActive) - Number(left.isActive) ||
      right.currentMMR - left.currentMMR ||
      left.displayName.localeCompare(right.displayName),
  )
  const filteredPlayers = directoryPlayers.filter((player) =>
    player.displayName.toLowerCase().includes(search.trim().toLowerCase()),
  )

  async function reloadDataset(preferredHubId?: string) {
    const loaded = await fetchAdminDataset()
    setDataset(loaded)
    setHubId((current) => {
      if (preferredHubId && loaded.hubs.some((hub) => hub.id === preferredHubId)) {
        return preferredHubId
      }
      if (loaded.hubs.some((hub) => hub.id === current)) return current
      return loaded.hubs.find((hub) => hub.isActive)?.id ?? ''
    })
    setStartupError('')
    setError('')
    return loaded
  }

  async function saveHub(formData: FormData) {
    const name = String(formData.get('name') ?? '').trim()
    const location = String(formData.get('location') ?? '').trim()
    if (!name || !location) throw new Error('Enter both a hub name and location.')
    const hub = await createHubApi(name, location)
    await reloadDataset(hub.id)
    setDialog(null)
    setMessage(`${name} is ready to manage.`)
  }

  async function savePlayer(formData: FormData) {
    const displayName = String(formData.get('displayName') ?? '').trim()
    const playerHubId = editingPlayer?.hubId ?? String(formData.get('hubId') ?? '')
    if (!displayName || !dataset.hubs.some((hub) => hub.id === playerHubId)) {
      throw new Error('Enter a player name and choose a hub.')
    }
    if (editingPlayer && playerHubId !== editingPlayer.hubId) {
      throw new Error('The API does not support moving a player to another hub.')
    }
    const avatarUrl = String(formData.get('avatarUrl') ?? '').trim() || null
    if (editingPlayer) {
      await updatePlayerApi(
        editingPlayer.id,
        displayName,
        avatarUrl,
        formData.get('isActive') === 'on',
      )
    } else {
      await createPlayerApi(playerHubId, displayName, avatarUrl)
    }
    await reloadDataset()
    setDialog(null)
    setEditingPlayer(null)
    setMessage(`${displayName} ${editingPlayer ? 'updated' : 'added'}.`)
  }

  async function saveMatch(formData: FormData) {
    const matchHubId = String(formData.get('hubId') ?? '')
    const playedAtInput = String(formData.get('playedAt') ?? '')
    const team1Score = Number(formData.get('team1Score'))
    const team2Score = Number(formData.get('team2Score'))
    const playerIds = [0, 1, 2, 3].map((index) =>
      String(formData.get(`player-${index}`) ?? ''),
    )
    if (playerIds.some((playerId) => !playerId) || new Set(playerIds).size !== 4) {
      throw new Error('Select four different players for the two teams.')
    }
    if (
      !Number.isInteger(team1Score) ||
      !Number.isInteger(team2Score) ||
      team1Score < 0 ||
      team2Score < 0 ||
      team1Score === team2Score
    ) {
      throw new Error('Enter a non-tied, non-negative integer score.')
    }
    const matchHub = dataset.hubs.find((hub) => hub.id === matchHubId)
    const players = playerIds.map((playerId) =>
      dataset.players.find((player) =>
        player.id === playerId && player.hubId === matchHubId && player.isActive,
      ),
    )
    if (!matchHub || players.some((player) => !player)) {
      throw new Error('All selected players must be active in the selected hub.')
    }
    const video = String(formData.get('video') ?? '').trim()
    const youtubeVideoId = getYouTubeVideoId(video)
    if (video && !youtubeVideoId) {
      throw new Error('Enter a valid YouTube video URL or 11-character video ID.')
    }
    const playedAt = new Date(playedAtInput)
    if (Number.isNaN(playedAt.getTime())) throw new Error('Enter a valid match date.')

    await createMatchApi(matchHubId, {
      playedAt: playedAt.toISOString(),
      team1Score,
      team2Score,
      members: playerIds.map((playerId, index) => ({
        playerId,
        teamNumber: index < 2 ? 1 : 2,
      })),
      youtubeVideoId,
    })
    await reloadDataset()
    setDialog(null)
    setMessage('Match scheduled. Complete it to apply player MMR changes.')
  }

  async function finalizeMatch(match: Match) {
    if (!window.confirm('Complete this match and apply Elo rating changes to all participants?')) return
    try {
      await completeMatchApi(match.id, match.winningTeamNumber)
      await reloadDataset()
      setMessage('Match completed. Player MMR and rating history were updated by the API.')
    } catch (cause) {
      setError(errorMessage(cause))
    }
  }

  async function cancelMatch(match: Match) {
    if (!window.confirm('Cancel this scheduled match?')) return
    try {
      await cancelMatchApi(match.id)
      await reloadDataset()
      setMessage('Scheduled match cancelled.')
    } catch (cause) {
      setError(errorMessage(cause))
    }
  }

  async function togglePlayer(player: Player) {
    const isActive = !player.isActive
    const action = isActive ? 'reactivate' : 'deactivate'
    if (!window.confirm(`${action[0]?.toUpperCase()}${action.slice(1)} ${player.displayName}?`)) return
    try {
      await updatePlayerApi(player.id, player.displayName, player.avatarUrl, isActive)
      await reloadDataset()
      setMessage(`${player.displayName} ${isActive ? 'reactivated' : 'deactivated'}.`)
    } catch (cause) {
      setError(errorMessage(cause))
    }
  }

  async function refreshFromApi() {
    setLoading(true)
    try {
      await reloadDataset()
      setMessage('Admin data refreshed from the RankUp API.')
    } catch (cause) {
      const message = errorMessage(cause)
      setStartupError(message)
      setError(message)
    } finally {
      setLoading(false)
    }
  }

  function exportPublicJson() {
    try {
      const publicJson = createPublicDataset(dataset)
      downloadFile('public.json', publicJson, 'application/json')
      setError('')
      setMessage('public.json downloaded. Replace rank-up-webapp/src/data/public.json with this file.')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  function exportBackup() {
    try {
      downloadFile('rankup-admin-backup.json', createAdminBackup(dataset), 'application/json')
      setError('')
      setMessage('Full admin backup downloaded.')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  async function handleDialogSubmit(formData: FormData) {
    setSaving(true)
    setError('')
    try {
      if (dialog === 'hub') await saveHub(formData)
      if (dialog === 'player') await savePlayer(formData)
      if (dialog === 'match') await saveMatch(formData)
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setSaving(false)
    }
  }

  const matchFormPlayers = activeHub?.isActive ? activePlayers.length : 0
  const wins = hubMatches.filter((match) => match.status === 'Completed').length

  return (
    <div className="admin-shell">
      <aside className="sidebar">
        <a className="brand" href="/" aria-label="RankUp admin home">
          <span className="brand-mark">R</span>
          <span><strong>rankup</strong><small>CONTROL ROOM</small></span>
        </a>
        <div className="side-label">WORKSPACE</div>
        <nav className="side-nav" aria-label="Admin sections">
          <NavButton active={section === 'overview'} onClick={() => setSection('overview')} icon="▦">Overview</NavButton>
          <NavButton active={section === 'players'} onClick={() => setSection('players')} icon="♙" badge={activePlayers.length}>Players</NavButton>
          <NavButton active={section === 'matches'} onClick={() => setSection('matches')} icon="♜" badge={scheduled.length || undefined}>Matches</NavButton>
        </nav>
        <div className="sidebar-spacer" />
        <div className="sidebar-note"><span className="note-icon">✦</span><p>Every match is a chance to climb.</p><span>RankUp · Local admin workspace</span></div>
        <div className="admin-user">
          <div className="user-avatar">{user.email?.slice(0, 1).toUpperCase() ?? 'A'}</div>
          <div><strong>{user.email}</strong><small>Signed in</small></div>
          <button
            className="sign-out-button"
            type="button"
            title="Sign out"
            aria-label="Sign out"
            onClick={handleSignOut}
          >↪</button>
        </div>
      </aside>

      <main className="main-panel">
        <header className="topbar">
          <div className="mobile-brand"><span className="brand-mark">R</span> rankup</div>
          <button className="button button-quiet mobile-sign-out" type="button" onClick={handleSignOut}>Sign out</button>
          <div className="breadcrumb"><span>Workspace</span><i>/</i>{section}</div>
          <div className="topbar-actions">
            <span className={`connection ${startupError ? '' : 'is-online'}`}>
              <span />{startupError ? 'API OFFLINE' : loading ? 'CONNECTING' : 'API CONNECTED'}
            </span>
            <button className="button button-quiet" onClick={() => void refreshFromApi()} disabled={loading}>
              {loading ? 'Syncing…' : 'Refresh'}
            </button>
            <label className="hub-picker"><span>⌖</span>
              <select aria-label="Select hub" value={hubId} onChange={(event) => setHubId(event.target.value)} disabled={!dataset.hubs.length}>
                {dataset.hubs.map((hub) => <option value={hub.id} key={hub.id}>{hub.name}</option>)}
              </select><i>⌄</i>
            </label>
            <button className="button button-quiet" onClick={() => setDialog('hub')}>+ Hub</button>
          </div>
        </header>

        <div className="content">
          {(error || startupError || message) && <div className={`alert ${error || startupError ? 'alert-error' : 'alert-success'}`} role={error || startupError ? 'alert' : 'status'}>
            <span>{error || startupError || message}</span>
            <button aria-label="Dismiss message" onClick={() => { setError(''); setMessage(''); setStartupError('') }}>×</button>
          </div>}
          <section className="page-heading">
            <div>
              <div className="eyebrow"><span className="eyebrow-line" /> ADMIN DASHBOARD</div>
              <h1>{section === 'overview' ? 'The court is yours.' : section === 'players' ? 'Players' : 'Matches'}</h1>
              <p>{section === 'overview'
                ? `Your ${activeHub?.name ?? 'hub'} at a glance. Keep the competition moving.`
                : section === 'players'
                  ? 'Manage your roster and keep every player in the game.'
                  : 'Record results, verify matches, and update the rankings.'}</p>
            </div>
            <div className="heading-actions">
              <button className="button button-secondary" onClick={() => { setEditingPlayer(null); setDialog('player') }} disabled={!activeHub?.isActive || loading || Boolean(startupError)}>＋ Add player</button>
              {section !== 'players' && <button className="button button-primary" disabled={matchFormPlayers < 4} onClick={() => setDialog('match')}>＋ Record match</button>}
              <button
                className="button button-quiet export-toggle"
                type="button"
                aria-expanded={exportToolsOpen}
                aria-controls="data-export-tools"
                onClick={() => setExportToolsOpen((open) => !open)}
              >{exportToolsOpen ? 'Hide exports' : 'Export data'}</button>
            </div>
          </section>
          <section className="publish-bar" id="data-export-tools" aria-label="Data export" hidden={!exportToolsOpen}>
            <div><strong>API-backed data</strong><span>Publish API results for the public RankUp website.</span></div>
            <div className="publish-actions">
              <button className="button button-secondary" onClick={exportBackup} disabled={loading || Boolean(startupError)}>Export API backup</button>
              <button className="button button-primary" onClick={exportPublicJson} disabled={loading || Boolean(startupError)}>Download public.json</button>
            </div>
          </section>

          {loading ? (
            <section className="panel"><Empty title="Loading API data" text="Connecting to the RankUp API and loading hubs, players, and matches." /></section>
          ) : startupError ? (
            <section className="panel"><Empty title="API unavailable" text="The admin app cannot load its data. Check that the RankUp API is running, then try again."><button className="button button-primary" onClick={() => void refreshFromApi()}>Retry connection</button></Empty></section>
          ) : section === 'overview' ? (
            <Overview
              players={rankedPlayers}
              matches={hubMatches}
              scheduled={scheduled.length}
              completed={wins}
              onSection={setSection}
              onFinalize={finalizeMatch}
              onCancel={cancelMatch}
            />
          ) : section === 'players' ? (
            <Players
              players={filteredPlayers}
              matches={hubMatches}
              query={search}
              onQuery={setSearch}
              onEdit={(player) => { setEditingPlayer(player); setDialog('player') }}
              onDeactivate={(player) => void togglePlayer(player)}
            />
          ) : (
            <Matches
              matches={hubMatches}
              onFinalize={finalizeMatch}
              onCancel={cancelMatch}
            />
          )}
          <footer className="admin-footer">LIVE RANKUP API DATA <span>·</span> PUBLIC DATA IS EXPORTED FROM THIS WORKSPACE</footer>
        </div>
      </main>

      {dialog && (
        <Dialog
          type={dialog}
          hubs={dataset.hubs.filter((hub) => hub.isActive)}
          players={activePlayers}
          editingPlayer={editingPlayer}
          selectedHubId={hubId}
          onClose={() => { setDialog(null); setEditingPlayer(null) }}
          onSubmit={(formData) => void handleDialogSubmit(formData)}
          saving={saving}
        />
      )}
    </div>
  )
}

function NavButton({
  active,
  icon,
  badge,
  onClick,
  children,
}: {
  active: boolean
  icon: string
  badge?: number
  onClick: () => void
  children: string
}) {
  return <button className={`nav-item ${active ? 'nav-active' : ''}`} onClick={onClick}>
    <span className="nav-icon">{icon}</span><span>{children}</span>{badge ? <small>{badge}</small> : null}
  </button>
}

function Overview({
  players,
  matches,
  scheduled,
  completed,
  onSection,
  onFinalize,
  onCancel,
}: {
  players: Player[]
  matches: Match[]
  scheduled: number
  completed: number
  onSection: (section: Section) => void
  onFinalize: (match: Match) => void
  onCancel: (match: Match) => void
}) {
  return <>
    <section className="stats-grid">
      <Stat label="Active players" value={players.length} note="IN YOUR ROSTER" icon="♙" />
      <Stat label="Matches recorded" value={matches.length} note="ALL-TIME AT THIS HUB" icon="♜" />
      <Stat label="Official results" value={completed} note="MMR APPLIED" icon="↗" />
      <Stat label="Awaiting result" value={scheduled} note="READY TO VERIFY" icon="◷" accent />
    </section>
    <section className="dashboard-grid">
      <div className="panel matches-panel">
        <PanelHeading kicker="LATEST ACTIVITY" title="Recent matches" action="All matches" onAction={() => onSection('matches')} />
        {matches.length
          ? <MatchTable matches={matches.slice(0, 5)} onFinalize={onFinalize} onCancel={onCancel} />
          : <Empty title="No matches yet" text="Record the first result to kick off your leaderboard." />}
      </div>
      <div className="panel leaderboard-panel">
        <PanelHeading kicker="THE CLIMB" title="Top players" action="Roster" onAction={() => onSection('players')} />
        {players.length ? <div className="top-players">
          {players.slice(0, 5).map((player, index) => <div className="top-player" key={player.id}>
            <span className={`rank-number ${index === 0 ? 'rank-first' : ''}`}>{String(index + 1).padStart(2, '0')}</span>
            <Avatar player={player} />
            <div className="top-player-name"><strong>{player.displayName}</strong><span>{index === 0 ? 'LEADER' : `RANK #${index + 1}`}</span></div>
            <strong className="mmr-value">{player.currentMMR.toLocaleString()}<small> MMR</small></strong>
          </div>)}
        </div> : <Empty title="Roster is empty" text="Add players to see the rankings." />}
      </div>
    </section>
  </>
}

function Players({
  players,
  matches,
  query,
  onQuery,
  onEdit,
  onDeactivate,
}: {
  players: Player[]
  matches: Match[]
  query: string
  onQuery: (value: string) => void
  onEdit: (player: Player) => void
  onDeactivate: (player: Player) => void
}) {
  return <section className="panel directory-panel">
    <div className="panel-heading directory-heading">
      <div><span className="section-kicker">PLAYER DIRECTORY</span><h2>Hub roster <span className="count-pill">{players.length}</span></h2></div>
      <label className="search-field"><span>⌕</span><input value={query} onChange={(event) => onQuery(event.target.value)} placeholder="Search players" /></label>
    </div>
    {players.length ? <div className="table-scroll"><table className="data-table player-table">
      <thead><tr><th>PLAYER</th><th>RATING</th><th>RECORD</th><th>STATUS</th><th>ACTIONS</th></tr></thead>
      <tbody>{players.map((player) => {
        const history = datasetResults(player, matches)
        return <tr key={player.id}>
          <td><div className="player-cell"><Avatar player={player} /><strong>{player.displayName}</strong></div></td>
          <td><strong className="table-mmr">{player.currentMMR.toLocaleString()}</strong><span className="table-mmr-unit"> MMR</span></td>
          <td>{history.wins}W - {history.losses}L</td>
          <td><span className={`status-tag ${player.isActive ? 'status-active' : 'status-cancelled'}`}><span />{player.isActive ? 'Active' : 'Inactive'}</span></td>
          <td className="row-actions"><button className="text-button" onClick={() => onEdit(player)}>Edit</button><button className="text-button" onClick={() => onDeactivate(player)}>{player.isActive ? 'Deactivate' : 'Reactivate'}</button></td>
        </tr>
      })}</tbody>
    </table></div> : <Empty title="No players found" text="Try another search or add a player to your roster." />}
  </section>
}

function datasetResults(player: Player, matches: Match[]) {
  const played = matches.filter((match) =>
    match.status === 'Completed' &&
    match.isOfficial &&
    match.members.some((member) => member.playerId === player.id),
  )
  const wins = played.filter((match) => match.winningTeamNumber === match.members.find((member) => member.playerId === player.id)?.teamNumber).length
  return { wins, losses: played.length - wins }
}

function Matches({
  matches,
  onFinalize,
  onCancel,
}: {
  matches: Match[]
  onFinalize: (match: Match) => void
  onCancel: (match: Match) => void
}) {
  return <section className="panel matches-list-panel">
    <PanelHeading kicker="MATCH CENTER" title="All matches" />
    {matches.length
      ? <MatchTable matches={matches} onFinalize={onFinalize} onCancel={onCancel} />
      : <Empty title="No matches recorded" text="Log a match to start tracking results and MMR changes." />}
  </section>
}

function MatchTable({
  matches,
  onFinalize,
  onCancel,
}: {
  matches: Match[]
  onFinalize: (match: Match) => void
  onCancel: (match: Match) => void
}) {
  return <div className="table-scroll"><table className="data-table match-table">
    <thead><tr><th>DATE</th><th>TEAMS</th><th>SCORE</th><th>STATUS</th><th>ACTIONS</th></tr></thead>
    <tbody>{matches.map((match) => <tr key={match.id}>
      <td><span className="match-date">{formatDate(match.playedAt)}</span></td>
      <td><div className="match-teams"><span>{teamNames(match, 1)}</span><i>vs</i><span>{teamNames(match, 2)}</span></div>
        {match.youtubeVideoUrl && <a className="video-indicator" href={match.youtubeVideoUrl} target="_blank" rel="noreferrer">▶ Video linked</a>}
      </td>
      <td><strong className="score">{match.team1Score}<i>:</i>{match.team2Score}</strong></td>
      <td><span className={`status-tag status-${match.status.toLowerCase()}`}><span />{match.status}</span></td>
      <td className="row-actions">
        {match.status === 'Scheduled' ? <>
          <button className="complete-button" onClick={() => onFinalize(match)}>Complete & apply MMR</button>
          <button className="text-button" onClick={() => onCancel(match)}>Cancel</button>
        </> : match.status === 'Completed' ? <>
          <span className="winner-label">Team {match.winningTeamNumber} won</span>
        </> : null}
      </td>
    </tr>)}</tbody>
  </table></div>
}

function Dialog({
  type,
  hubs,
  players,
  editingPlayer,
  selectedHubId,
  onClose,
  onSubmit,
  saving,
}: {
  type: Exclude<Dialog, null>
  hubs: Hub[]
  players: Player[]
  editingPlayer: Player | null
  selectedHubId: string
  onClose: () => void
  onSubmit: (formData: FormData) => void
  saving: boolean
}) {
  const title = type === 'hub' ? 'Create a hub'
    : type === 'player' ? editingPlayer ? 'Edit player' : 'Add player'
      : 'Record a match'
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="modal-title">
      <div className="modal-heading"><div><span className="section-kicker">RANKUP ADMIN</span><h2 id="modal-title">{title}</h2><p>Changes are saved to the RankUp API.</p></div><button className="icon-button" aria-label="Close dialog" onClick={onClose}>×</button></div>
      <form className="form-stack" onSubmit={(event) => { event.preventDefault(); onSubmit(new FormData(event.currentTarget)) }}>
        {type === 'hub' && <>
          <Field label="Hub name"><input name="name" required maxLength={200} placeholder="e.g. Northside Courts" /></Field>
          <Field label="Location"><input name="location" required maxLength={300} placeholder="City, country" /></Field>
        </>}
        {type === 'player' && <>
          <Field label="Display name"><input name="displayName" required maxLength={100} defaultValue={editingPlayer?.displayName ?? ''} placeholder="Player name" /></Field>
          <Field label="Avatar URL"><input name="avatarUrl" type="url" defaultValue={editingPlayer?.avatarUrl ?? ''} placeholder="Optional image URL" /></Field>
          <Field label="Hub"><select name="hubId" defaultValue={editingPlayer?.hubId ?? selectedHubId} disabled={Boolean(editingPlayer)}>{hubs.map((hub) => <option key={hub.id} value={hub.id}>{hub.name}</option>)}</select></Field>
          <label className="checkbox-field"><input name="isActive" type="checkbox" defaultChecked={editingPlayer?.isActive ?? true} /> Active player</label>
        </>}
        {type === 'match' && <>
          <Field label="Hub"><select name="hubId" defaultValue={selectedHubId} required>{hubs.map((hub) => <option value={hub.id} key={hub.id}>{hub.name}</option>)}</select></Field>
          <Field label="Played at"><input name="playedAt" type="datetime-local" defaultValue={localDateTime()} required /></Field>
          <div className="team-composer">{[0, 1].map((team) => <div className={`team-card team-card-${team + 1}`} key={team}>
            <div className="team-title"><span>TEAM 0{team + 1}</span><strong>{team === 0 ? 'Side A' : 'Side B'}</strong></div>
            {[0, 1].map((slot) => {
              const index = team * 2 + slot
              return <Field label={`Player ${slot + 1}`} key={index}><select name={`player-${index}`} required defaultValue=""><option value="" disabled>Choose player</option>{players.map((player) => <option value={player.id} key={player.id}>{player.displayName} · {player.currentMMR} MMR</option>)}</select></Field>
            })}
          </div>)}</div>
          <div className="form-row"><Field label="Team 1 score"><input name="team1Score" type="number" min="0" defaultValue="21" required /></Field><span className="score-separator">VS</span><Field label="Team 2 score"><input name="team2Score" type="number" min="0" defaultValue="18" required /></Field></div>
          <Field label="YouTube URL (optional)"><input name="video" type="url" placeholder="https://youtube.com/watch?v=…" /></Field>
          {players.length < 4 && <p className="form-error">Add four active hub players before recording a match.</p>}
        </>}
        <div className="modal-actions"><button type="button" className="button button-quiet" onClick={onClose} disabled={saving}>Cancel</button><button type="submit" className="button button-primary" disabled={saving || (type === 'match' && players.length < 4)}>{saving ? 'Saving…' : title}</button></div>
      </form>
    </section>
  </div>
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="field"><span className="field-label">{label}</span>{children}</label>
}

function PanelHeading({ kicker, title, action, onAction }: { kicker: string; title: string; action?: string; onAction?: () => void }) {
  return <div className="panel-heading"><div><span className="section-kicker">{kicker}</span><h2>{title}</h2></div>{action && onAction && <button className="text-button" onClick={onAction}>{action} →</button>}</div>
}

function Stat({ label, value, note, icon, accent = false }: { label: string; value: number; note: string; icon: string; accent?: boolean }) {
  return <article className={`stat-card ${accent ? 'stat-accent' : ''}`}><div className="stat-top"><span>{label}</span><span className="stat-icon">{icon}</span></div><strong className="stat-value">{value.toLocaleString()}</strong><div className="stat-foot"><span>↗</span>{note}</div></article>
}

function Avatar({ player }: { player: Pick<Player, 'displayName' | 'avatarUrl'> }) {
  return player.avatarUrl
    ? <img className="avatar" src={player.avatarUrl} alt="" />
    : <span className="avatar avatar-fallback">{player.displayName.slice(0, 1).toUpperCase()}</span>
}

function Empty({ title, text, children }: { title: string; text: string; children?: React.ReactNode }) {
  return <div className="empty-inline"><span className="empty-mini">✦</span><strong>{title}</strong><p>{text}</p>{children}</div>
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(value))
}

function teamNames(match: Match, team: 1 | 2) {
  return match.members.filter((member) => member.teamNumber === team).map((member) => member.displayName).join(' & ')
}

function localDateTime() {
  const date = new Date()
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset())
  return date.toISOString().slice(0, 16)
}

function errorMessage(cause: unknown) {
  return cause instanceof Error
    ? cause.message
    : 'Unexpected error while communicating with the RankUp API.'
}

export default App
