// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { initI18n } from '../../../i18n'
import { JobActionDialog } from './JobActionDialog'

vi.hoisted(() => {
  ;(globalThis as unknown as { q2: unknown }).q2 = {
    invoke: vi.fn(async () => ({ ok: true })),
    on: vi.fn(() => () => {}),
  }
})

beforeAll(async () => {
  await initI18n('en')
})
afterEach(cleanup)

function renderDialog(jobId: string | null) {
  return render(
    <JobActionDialog
      title="T"
      description="D"
      onClose={() => {}}
      starting={false}
      jobId={jobId}
      job={undefined}
      dismissTestId="x-dismiss"
      footer={<button type="button">own-footer</button>}
    >
      <p>own-body</p>
    </JobActionDialog>,
  )
}

describe('JobActionDialog', () => {
  it('dismiss reads jobs.dismiss', () => {
    renderDialog('job-1')
    expect(screen.getByTestId('x-dismiss').textContent).toBe('Run in background')
    expect(screen.queryByText('own-body')).toBeNull()
  })

  it('shows the caller body and footer before a job exists', () => {
    renderDialog(null)
    expect(screen.getByText('own-body')).toBeTruthy()
    expect(screen.getByText('own-footer')).toBeTruthy()
    expect(screen.queryByTestId('x-dismiss')).toBeNull()
  })
})
