/**
 * Dashboard — Mission Control
 *
 * Shows the active goal, Today's Next Action, progress ring, and a
 * Start Session button. Maps to the web app's dashboard/mission control.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  RefreshControl,
  ScrollView,
} from 'react-native';
import { useAuth } from '../../src/contexts/AuthContext';
import { apiFetch } from '../../src/lib/api';

type Goal = {
  id: string;
  title: string;
  targetDate: string;
  status: string;
};

type NextAction = {
  taskId: string;
  conceptTitle: string;
  rationale: string;
  estimatedMinutes: number;
  priority: number;
};

type MissionControl = {
  goal: Goal;
  nextAction: NextAction | null;
  daysRemaining: number;
  completedToday: number;
  plannedToday: number;
  masteryPercent: number;
};

export default function DashboardScreen() {
  const { state } = useAuth();
  const token = state.status === 'authenticated' ? state.token : null;
  const user = state.status === 'authenticated' ? state.user : null;

  const [goals, setGoals] = useState<Goal[]>([]);
  const [activeGoalId, setActiveGoalId] = useState<string | null>(null);
  const [missionControl, setMissionControl] = useState<MissionControl | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sessionLoading, setSessionLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const loadData = useCallback(
    async (isRefresh = false) => {
      if (!token) return;
      if (!isRefresh) setLoading(true);
      try {
        const goalsRes = await apiFetch<{ data: Goal[] }>('/api/v1/goals', { token });
        const activeGoal =
          goalsRes.data.find((g) => g.status === 'active') ?? goalsRes.data[0] ?? null;
        setGoals(goalsRes.data);

        if (activeGoal) {
          setActiveGoalId(activeGoal.id);
          const mcRes = await apiFetch<{ data: MissionControl }>(
            `/api/v1/goals/${activeGoal.id}/mission-control`,
            { token },
          );
          setMissionControl(mcRes.data);
        } else {
          setMissionControl(null);
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Failed to load dashboard.';
        if (!isRefresh) Alert.alert('Error', message);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [token],
  );

  useEffect(() => {
    loadData();
  }, [loadData]);

  async function handleStartSession() {
    if (!token || !missionControl?.nextAction) return;
    setSessionLoading(true);
    try {
      const res = await apiFetch<{
        data: { id: string; taskId: string; status: string };
      }>('/api/v1/sessions', {
        method: 'POST',
        token,
        body: {
          goalId: activeGoalId,
          taskId: missionControl.nextAction.taskId,
          plannedMinutes: missionControl.nextAction.estimatedMinutes,
        },
      });
      setSessionId(res.data.id);
      Alert.alert(
        'Session started ✓',
        `Study session for "${missionControl.nextAction.conceptTitle}" has begun. Complete it when you're done.`,
        [
          {
            text: 'Complete now',
            onPress: () => handleCompleteSession(res.data.id),
          },
          { text: 'Later', style: 'cancel' },
        ],
      );
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to start session.';
      Alert.alert('Error', message);
    } finally {
      setSessionLoading(false);
    }
  }

  async function handleCompleteSession(sid: string) {
    if (!token) return;
    setSessionLoading(true);
    try {
      await apiFetch(`/api/v1/sessions/${sid}/complete`, {
        method: 'POST',
        token,
        body: { rating: 3, activeMinutes: missionControl?.nextAction?.estimatedMinutes ?? 25 },
      });
      setSessionId(null);
      Alert.alert('Session complete ✓', 'Great work! Your mastery has been updated.');
      loadData();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to complete session.';
      Alert.alert('Error', message);
    } finally {
      setSessionLoading(false);
    }
  }

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#1d4ed8" />
        <Text style={styles.loadingText}>Loading dashboard…</Text>
      </View>
    );
  }

  if (!missionControl) {
    return (
      <View style={styles.centered}>
        <Text style={styles.emptyIcon}>🎯</Text>
        <Text style={styles.emptyTitle}>No active goal</Text>
        <Text style={styles.emptyBody}>
          Create a goal on the FRIDAY web app to get started.
        </Text>
      </View>
    );
  }

  const { goal, nextAction, daysRemaining, completedToday, plannedToday, masteryPercent } =
    missionControl;
  const masteryFraction = (masteryPercent ?? 0) / 100;
  const todayFraction = plannedToday > 0 ? completedToday / plannedToday : 0;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => {
            setRefreshing(true);
            loadData(true);
          }}
          tintColor="#1d4ed8"
        />
      }
    >
      {/* Greeting */}
      <Text style={styles.greeting}>Good to see you, {user?.name?.split(' ')[0] ?? 'there'} 👋</Text>

      {/* Goal card */}
      <View style={styles.card}>
        <Text style={styles.cardLabel}>Active goal</Text>
        <Text style={styles.cardTitle}>{goal.title}</Text>
        <Text style={styles.cardMeta}>
          {daysRemaining > 0 ? `${daysRemaining} days remaining` : 'Deadline reached'}
        </Text>
      </View>

      {/* Progress summary */}
      <View style={styles.statsRow}>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>{Math.round(masteryFraction * 100)}%</Text>
          <Text style={styles.statLabel}>Mastery</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>{completedToday}</Text>
          <Text style={styles.statLabel}>Done today</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>{plannedToday}</Text>
          <Text style={styles.statLabel}>Planned today</Text>
        </View>
      </View>

      {/* Next Action */}
      {nextAction ? (
        <View style={styles.nextActionCard}>
          <Text style={styles.nextActionLabel}>Next Action</Text>
          <Text style={styles.nextActionTitle}>{nextAction.conceptTitle}</Text>
          <Text style={styles.nextActionRationale}>{nextAction.rationale}</Text>
          <View style={styles.nextActionMeta}>
            <Text style={styles.metaTag}>~{nextAction.estimatedMinutes} min</Text>
            <Text style={styles.metaTag}>Priority {Math.round(nextAction.priority * 100)}</Text>
          </View>

          {sessionId ? (
            <TouchableOpacity
              style={[styles.button, styles.buttonSuccess]}
              onPress={() => handleCompleteSession(sessionId)}
              disabled={sessionLoading}
              activeOpacity={0.8}
            >
              {sessionLoading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.buttonText}>Complete Session ✓</Text>
              )}
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={[styles.button, sessionLoading && styles.buttonDisabled]}
              onPress={handleStartSession}
              disabled={sessionLoading}
              activeOpacity={0.8}
            >
              {sessionLoading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.buttonText}>Start Session →</Text>
              )}
            </TouchableOpacity>
          )}
        </View>
      ) : (
        <View style={styles.doneCard}>
          <Text style={styles.doneIcon}>🎉</Text>
          <Text style={styles.doneTitle}>All done for today!</Text>
          <Text style={styles.doneBody}>
            You've completed today's study plan. Come back tomorrow.
          </Text>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f9fafb' },
  content: { padding: 20, paddingBottom: 40 },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
    backgroundColor: '#f9fafb',
  },
  loadingText: { marginTop: 12, color: '#6b7280', fontSize: 15 },
  emptyIcon: { fontSize: 48, marginBottom: 12 },
  emptyTitle: { fontSize: 20, fontWeight: '700', color: '#111827', marginBottom: 8 },
  emptyBody: { fontSize: 15, color: '#6b7280', textAlign: 'center', lineHeight: 22 },
  greeting: {
    fontSize: 22,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 20,
  },
  card: {
    backgroundColor: '#1d4ed8',
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
  },
  cardLabel: { fontSize: 12, color: '#93c5fd', fontWeight: '600', textTransform: 'uppercase', letterSpacing: 1 },
  cardTitle: { fontSize: 20, fontWeight: '700', color: '#fff', marginTop: 4 },
  cardMeta: { fontSize: 13, color: '#bfdbfe', marginTop: 4 },
  statsRow: { flexDirection: 'row', gap: 12, marginBottom: 16 },
  statCard: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  statValue: { fontSize: 22, fontWeight: '800', color: '#111827' },
  statLabel: { fontSize: 12, color: '#6b7280', marginTop: 2 },
  nextActionCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 20,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  nextActionLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#1d4ed8',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 6,
  },
  nextActionTitle: { fontSize: 20, fontWeight: '700', color: '#111827', marginBottom: 8 },
  nextActionRationale: { fontSize: 14, color: '#4b5563', lineHeight: 20, marginBottom: 12 },
  nextActionMeta: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  metaTag: {
    backgroundColor: '#eff6ff',
    color: '#1d4ed8',
    fontSize: 12,
    fontWeight: '600',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 100,
  },
  button: {
    backgroundColor: '#1d4ed8',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
  },
  buttonSuccess: { backgroundColor: '#16a34a' },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  doneCard: {
    backgroundColor: '#f0fdf4',
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#bbf7d0',
  },
  doneIcon: { fontSize: 36, marginBottom: 8 },
  doneTitle: { fontSize: 18, fontWeight: '700', color: '#15803d', marginBottom: 4 },
  doneBody: { fontSize: 14, color: '#166534', textAlign: 'center', lineHeight: 20 },
});
