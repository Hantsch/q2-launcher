import { useTranslation } from 'react-i18next'
import { FolderOpen, HardDriveDownload, Search } from 'lucide-react'
import { useLauncher } from '../../store/useLauncher'
import type { MenuItem } from '../ui/Menu'

/** The one list of ways to add an installation, shared by the rail menu and the Library. */
export function useAddInstallationEntries(): MenuItem[] {
  const { t } = useTranslation()
  const openDialog = useLauncher((state) => state.openDialog)

  return [
    {
      id: 'add-existing',
      label: t('common.action.addExistingInstallation'),
      hint: t('addInstallation.hint.existing'),
      icon: <FolderOpen className="size-4" />,
      onSelect: () => openDialog({ kind: 'add-existing' }),
    },
    {
      id: 'detect',
      label: t('rail.autoDetect'),
      hint: t('addInstallation.hint.detect'),
      icon: <Search className="size-4" />,
      onSelect: () => openDialog({ kind: 'detect' }),
    },
    {
      id: 'new',
      label: t('addInstallation.new'),
      hint: t('addInstallation.hint.new'),
      icon: <HardDriveDownload className="size-4" />,
      onSelect: () =>
        openDialog({ kind: 'module', moduleId: 'downloads', view: 'bootstrap-wizard' }),
    },
  ]
}
