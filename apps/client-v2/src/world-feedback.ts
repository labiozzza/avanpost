interface ResidentFeedback {
  id: string;
  name: string;
  blockedReason?: string | null;
  task?: { blockedReason?: string | null; phase?: string } | null;
}

interface UndergroundJobFeedback {
  kind: string;
  status: string;
  blockedReason?: string | null;
  depositId?: string | null;
  assignedResidentId?: string | null;
}

function residentsWaitingLabel(count: number): string {
  const lastTwo = count % 100;
  const last = count % 10;
  const noun = last === 1 && lastTwo !== 11 ? 'житель'
    : last >= 2 && last <= 4 && (lastTwo < 12 || lastTwo > 14) ? 'жителя' : 'жителей';
  return `${count} ${noun} ${count === 1 ? 'ждёт' : 'ждут'} разгрузки`;
}

export function worldBlockerMessages(
  residents: readonly ResidentFeedback[],
  jobs: readonly UndergroundJobFeedback[]
): string[] {
  const messages: string[] = [];
  const blockedStorageResidents = residents.filter((resident) =>
    resident.blockedReason === 'STORAGE_FULL' || resident.task?.blockedReason === 'STORAGE_FULL').length;
  if (blockedStorageResidents > 0) {
    messages.push(`Склад заполнен: ${residentsWaitingLabel(blockedStorageResidents)}. Постройте ещё один склад или освободите место.`);
  }

  if (jobs.some((job) => job.kind === 'mine' && job.status === 'waiting_path' && job.blockedReason === 'LOCAL_BUFFER_FULL')) {
    messages.push('Добыча приостановлена: буфер шахты заполнен. Освободите место на складе, чтобы вывезти камень.');
  }
  if (jobs.some((job) => job.kind === 'mine' && job.status === 'waiting_path' && job.blockedReason === 'NO_PATH_TO_EXCAVATION')) {
    messages.push('Добыча в очереди: пока нет свободного жителя или пути к месторождению.');
  }
  return messages;
}

export function miningCommandFeedback(
  depositId: string,
  jobs: readonly UndergroundJobFeedback[],
  residents: readonly ResidentFeedback[]
): string {
  const job = [...jobs].reverse().find((item) => item.kind === 'mine' && item.depositId === depositId &&
    ['queued', 'in_progress', 'waiting_path'].includes(item.status));
  if (!job) return 'Поручение на добычу принято, но активное задание не найдено. Проверьте месторождение.';
  if (job.blockedReason === 'LOCAL_BUFFER_FULL') {
    return 'Добыча приостановлена: буфер шахты заполнен. Освободите место на складе, чтобы вывезти камень.';
  }
  if (job.blockedReason === 'NO_PATH_TO_EXCAVATION') {
    return 'Добыча поставлена в очередь: пока нет свободного жителя или пути к месторождению.';
  }
  const miner = job.assignedResidentId ? residents.find((resident) => resident.id === job.assignedResidentId) : undefined;
  if (!miner) return 'Поручение на добычу поставлено в очередь.';
  return miner.task?.phase === 'working'
    ? `${miner.name} начал добывать камень.`
    : `${miner.name} идёт к месторождению; добыча начнётся по прибытии.`;
}
