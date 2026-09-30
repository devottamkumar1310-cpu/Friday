import type { Metadata } from 'next';
import Link from 'next/link';
import { Button, PageHeader, SectionHeader } from '@friday/ui';
import { requireUser } from '@/lib/auth/server';
import { getAvailability, getPreferences } from '@/modules/identity/settings.service';
import { ProfileForm } from '@/components/settings/profile-form';
import { FeedbackForm } from '@/components/platform/feedback-form';
import { PreferencesForm } from '@/components/settings/preferences-form';
import { DeleteAccountButton } from '@/components/settings/delete-account-button';

export const metadata: Metadata = { title: 'Settings' };

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export default async function SettingsPage() {
  const user = await requireUser();
  const [availability, preferences] = await Promise.all([
    getAvailability(user),
    getPreferences(user),
  ]);

  const hours = Math.floor(availability.weeklyMinutes / 60);
  const minutes = availability.weeklyMinutes % 60;

  return (
    <div className="mx-auto max-w-2xl space-y-0 py-2">
      <div className="pb-8">
        <PageHeader
          title="Settings"
          description="Your profile, schedule, and preferences. Everything FRIDAY plans is measured against what you set here."
        />
      </div>

      {/* ── Account ── */}
      <section aria-labelledby="section-account" className="border-t border-border pt-8 pb-10">
        <div className="mb-6">
          <SectionHeader
            id="section-account"
            title="Account"
            description="Your timezone drives when everything is scheduled and when FRIDAY may contact you."
          />
        </div>
        <ProfileForm
          displayName={user.displayName}
          timezone={user.timezone}
          locale={user.locale}
          email={user.email}
        />
      </section>

      {/* ── Study Availability ── */}
      <section aria-labelledby="section-availability" className="border-t border-border pt-8 pb-10">
        <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
          <div>
            <SectionHeader
              id="section-availability"
              title="Study availability"
              description={
                availability.rules.length === 0
                  ? 'No availability set — FRIDAY cannot build a plan until you add some.'
                  : `${hours}h ${minutes}m a week across ${availability.rules.length} slot${availability.rules.length === 1 ? '' : 's'}. Every forecast is measured against this.`
              }
            />
          </div>
          <Button variant="secondary" size="sm" asChild className="px-4">
            <Link href="/onboarding/availability">Edit schedule</Link>
          </Button>
        </div>

        {availability.rules.length > 0 && (
          <ul
            className="divide-y divide-border rounded-xl border border-border text-sm"
            aria-label="Study schedule"
          >
            {[...availability.rules]
              .sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.startTime.localeCompare(b.startTime))
              .map((rule) => (
                <li
                  key={rule.id}
                  className="flex items-center justify-between gap-3 px-4 py-2.5"
                >
                  <span className="text-foreground">{DAY_NAMES[rule.dayOfWeek]}</span>
                  <span className="font-mono text-xs text-muted-foreground">
                    {rule.startTime} – {rule.endTime}
                  </span>
                </li>
              ))}
          </ul>
        )}
      </section>

      {/* ── Preferences ── */}
      <section aria-labelledby="section-preferences" className="border-t border-border pt-8 pb-10">
        <div className="mb-6">
          <SectionHeader
            id="section-preferences"
            title="Preferences"
            description="Quiet hours are respected by anything FRIDAY sends you unprompted."
          />
        </div>
        <PreferencesForm
          quietHoursStart={preferences.quietHoursStart}
          quietHoursEnd={preferences.quietHoursEnd}
          maxDirectivesPerDay={preferences.maxDirectivesPerDay}
          theme={preferences.theme}
        />
      </section>

      {/* ── Feedback ── */}
      <section aria-labelledby="section-feedback" className="border-t border-border pt-8 pb-10">
        <div className="mb-6">
          <SectionHeader
            id="section-feedback"
            title="Feedback"
            description="FRIDAY is in beta. Someone reads every message during it, and the things people report here are what gets fixed first."
          />
        </div>
        <FeedbackForm />
      </section>

      {/* ── Privacy & Data ── */}
      <section aria-labelledby="section-privacy" className="border-t border-border pt-8 pb-10">
        <div className="mb-6">
          <SectionHeader
            id="section-privacy"
            title="Privacy & data"
            description="Every belief FRIDAY holds about you is visible, correctable, and deletable."
          />
        </div>
        <Button variant="secondary" size="sm" asChild className="px-4">
          <Link href="/memory">Review beliefs</Link>
        </Button>
      </section>

      {/* ── Danger Zone ── */}
      <section aria-labelledby="section-danger" className="border-t border-border pt-8 pb-10">
        <div className="mb-6">
          <SectionHeader
            id="section-danger"
            title="Danger zone"
            description="Permanent, irreversible actions. Read carefully before proceeding."
          />
        </div>
        <div className="rounded-xl border border-destructive/20 bg-destructive/5 p-6">
          <p className="mb-1 text-sm font-medium text-foreground">Delete account</p>
          <p className="mb-4 text-sm text-muted-foreground">
            Permanently delete your account, study history, and all stored data. This cannot
            be undone.
          </p>
          <DeleteAccountButton />
        </div>
      </section>

    </div>
  );
}
