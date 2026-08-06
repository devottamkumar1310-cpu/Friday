import type { Metadata } from 'next';
import Link from 'next/link';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@friday/ui';
import { requireUser } from '@/lib/auth/server';
import { getAvailability, getPreferences } from '@/modules/identity/settings.service';
import { ProfileForm } from '@/components/settings/profile-form';
import { PreferencesForm } from '@/components/settings/preferences-form';

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
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Your profile, schedule, and preferences.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Profile</CardTitle>
          <CardDescription>
            Your timezone drives when everything is scheduled and when FRIDAY may contact you.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ProfileForm
            displayName={user.displayName}
            timezone={user.timezone}
            locale={user.locale}
            email={user.email}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle>Study availability</CardTitle>
              <CardDescription>
                {hours}h {minutes}m a week across {availability.rules.length} slot
                {availability.rules.length === 1 ? '' : 's'}. Every forecast is measured against
                this.
              </CardDescription>
            </div>
            <Button variant="secondary" size="sm" asChild>
              <Link href="/onboarding/availability">Edit schedule</Link>
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {availability.rules.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No availability set — FRIDAY cannot build a plan until you add some.
            </p>
          ) : (
            <ul className="divide-y divide-border text-sm">
              {[...availability.rules]
                .sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.startTime.localeCompare(b.startTime))
                .map((rule) => (
                  <li key={rule.id} className="flex items-center justify-between gap-3 py-2">
                    <span>{DAY_NAMES[rule.dayOfWeek]}</span>
                    <span className="font-mono text-xs text-muted-foreground">
                      {rule.startTime} – {rule.endTime}
                    </span>
                  </li>
                ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Preferences</CardTitle>
          <CardDescription>
            Quiet hours are respected by anything FRIDAY sends you unprompted.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <PreferencesForm
            quietHoursStart={preferences.quietHoursStart}
            quietHoursEnd={preferences.quietHoursEnd}
            maxDirectivesPerDay={preferences.maxDirectivesPerDay}
            theme={preferences.theme}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>What FRIDAY believes about you</CardTitle>
          <CardDescription>
            Every belief it holds is visible, correctable, and deletable.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="secondary" size="sm" asChild>
            <Link href="/memory">Review beliefs</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
