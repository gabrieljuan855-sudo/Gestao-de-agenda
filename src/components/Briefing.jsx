import { useState } from 'react'
import { busyMinutesOn, findFreeGaps } from '../lib/events.js'
import { isWorkday, workBlocksFor, workloadRatio } from '../lib/schedule.js'
import { formatDuration } from '../lib/dates.js'
import { overdueTasks, stalledTasks } from '../lib/tasks.js'
import Banner from './Banner.jsx'

// Resumo automático do dia, separado do "Bom dia" do topo — que continua só
// um cumprimento. O app já calcula tudo isso para outras telas (vãos livres
// do Dia, carga da Semana, "parado há X dias" do Backlog); juntar num só
// lugar poupa ter que abrir três telas para montar esse quadro na cabeça.
export default function Briefing({ events, tasks, occupies }) {
  const [dismissed, setDismissed] = useState(false)
  if (dismissed) return null

  const now = new Date()
  const overdue = overdueTasks(tasks, now)
  const stalled = stalledTasks(tasks)

  if (!isWorkday(now)) {
    // Fim de semana sem nada atrasado nem parado: não há o que avisar.
    if (overdue.length === 0 && stalled.length === 0) return null
    return (
      <Banner tone="warning" actionLabel="Dispensar" onAction={() => setDismissed(true)}>
        {partesPendencias(overdue, stalled)}
      </Banner>
    )
  }

  // Só os vãos que ainda cabem hoje — um de manhã já não serve de sugestão
  // à tarde.
  const gaps = findFreeGaps(events, now, workBlocksFor(now), { occupies }).filter((g) => g.end > now)
  const freeMinutes = gaps.reduce((sum, g) => sum + (g.end - g.start) / 60000, 0)
  const ratio = workloadRatio(busyMinutesOn(events, now, occupies), now)
  const nivel = ratio >= 0.75 ? 'dia lotado' : ratio >= 0.4 ? 'carga média' : 'dia tranquilo'

  const partes = [
    nivel,
    gaps.length > 0
      ? `${formatDuration(freeMinutes)} livres em ${gaps.length} ${gaps.length === 1 ? 'vão' : 'vãos'}`
      : 'sem vão livre sobrando',
  ]
  const pendencias = partesPendencias(overdue, stalled)
  if (pendencias) partes.push(pendencias)

  return (
    <Banner tone={overdue.length > 0 ? 'warning' : 'info'} actionLabel="Dispensar" onAction={() => setDismissed(true)}>
      {partes.join(' · ')}
    </Banner>
  )
}

function partesPendencias(overdue, stalled) {
  const bits = []
  if (overdue.length > 0) bits.push(`${overdue.length} ${overdue.length === 1 ? 'tarefa atrasada' : 'tarefas atrasadas'}`)
  if (stalled.length > 0) bits.push(`${stalled.length} ${stalled.length === 1 ? 'tarefa parada' : 'tarefas paradas'} há dias`)
  return bits.join(' · ') || null
}
