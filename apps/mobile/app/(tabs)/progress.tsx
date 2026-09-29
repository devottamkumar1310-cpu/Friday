/**
 * Progress screen — shows mastery percentage, weak concepts, and trend data.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  Alert,
  ScrollView,
  RefreshControl,
} from 'react-native';
import { useAuth } from '../../src/contexts/AuthContext';
import { apiFetch } from '../../src/lib/api';

type Goal = {
  id: string;
  title: string;
  status: string;
};

type ProgressData = {
  masteryPercent: number;
  completedConcepts: number;
  totalConcepts: number;
  onTrack: boolean;
  feasibilityVerdict: string;
};

type WeakConcept = {
  conceptId: string;
  title: string;
  mastery: number;
  evidence: number;
};

export default function ProgressScreen() {
  const { state } = useAuth();
  const token = state.status === 'authenticated' ? state.token : null;

  const [activeGoalId, setActiveGoalId] = useState<string | null>(null);
  const [progress, setProgress] = useState<ProgressData | null>(null);
  const [weakConcepts, setWeakConcepts] = useState<WeakConcept[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadData = useCallback(
    async (isRefresh = false) => {
      if (!token) return;
      if (!isRefresh) setLoading(true);
      try {
        const goalsRes = await apiFetch<{ data: Goal[] }>('/api/v1/goals', { token });
        const activeGoal =
          goalsRes.data.find((g) => g.status === 'active') ?? goalsRes.data[0] ?? null;

        if (activeGoal) {
          setActiveGoalId(activeGoal.id);

          const [progressRes, weakRes] = await Promise.all([
            apiFetch<{ data: ProgressData }>(
              `/api/v1/intelligence/progress?goalId=${activeGoal.id}`,
              { token },
            ),
            apiFetch<{ data: WeakConcept[] }>(
              `/api/v1/intelligence/weak-concepts?goalId=${activeGoal.id}&limit=10`,
              { token },
            ),
          ]);
          setProgress(progressRes.data);
          setWeakConcepts(weakRes.data ?? []);
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Failed to load progress.';
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

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#1d4ed8" />
        <Text style={styles.loadingText}>Loading progress…</Text>
      </View>
    );
  }

  if (!progress) {
    return (
      <View style={styles.centered}>
        <Text style={styles.emptyIcon}>📊</Text>
        <Text style={styles.emptyTitle}>No data yet</Text>
        <Text style={styles.emptyBody}>Complete some study sessions to see your progress.</Text>
      </View>
    );
  }

  const completionPct = progress.totalConcepts > 0
    ? Math.round((progress.completedConcepts / progress.totalConcepts) * 100)
    : 0;

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
      {/* Mastery ring (simplified numeric representation) */}
      <View style={styles.masteryCard}>
        <Text style={styles.masteryPercent}>{Math.round(progress.masteryPercent)}%</Text>
        <Text style={styles.masteryLabel}>Overall Mastery</Text>
        <View
          style={[
            styles.verdictBadge,
            progress.onTrack ? styles.verdictGreen : styles.verdictAmber,
          ]}
        >
          <Text style={styles.verdictText}>
            {progress.onTrack ? '✓ On track' : '⚠ At risk'}
          </Text>
        </View>
      </View>

      {/* Stats */}
      <View style={styles.statsRow}>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>{progress.completedConcepts}</Text>
          <Text style={styles.statLabel}>Mastered</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>{progress.totalConcepts}</Text>
          <Text style={styles.statLabel}>Total</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>{completionPct}%</Text>
          <Text style={styles.statLabel}>Completed</Text>
        </View>
      </View>

      {/* Feasibility */}
      {progress.feasibilityVerdict && (
        <View style={styles.feasibilityCard}>
          <Text style={styles.sectionLabel}>Feasibility</Text>
          <Text style={styles.feasibilityText}>{progress.feasibilityVerdict}</Text>
        </View>
      )}

      {/* Weak Concepts */}
      {weakConcepts.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Weak Concepts</Text>
          {weakConcepts.map((concept) => (
            <View key={concept.conceptId} style={styles.weakConceptCard}>
              <View style={styles.weakConceptHeader}>
                <Text style={styles.weakConceptTitle}>{concept.title}</Text>
                <Text style={styles.weakConceptMastery}>
                  {Math.round(concept.mastery * 100)}%
                </Text>
              </View>
              <View style={styles.progressBarBg}>
                <View
                  style={[
                    styles.progressBarFill,
                    { width: `${Math.round(concept.mastery * 100)}%` as `${number}%` },
                  ]}
                />
              </View>
              <Text style={styles.evidenceText}>{concept.evidence} evidence points</Text>
            </View>
          ))}
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
  masteryCard: {
    backgroundColor: '#1d4ed8',
    borderRadius: 20,
    padding: 32,
    alignItems: 'center',
    marginBottom: 16,
  },
  masteryPercent: { fontSize: 64, fontWeight: '800', color: '#fff' },
  masteryLabel: { fontSize: 16, color: '#bfdbfe', marginTop: 4 },
  verdictBadge: {
    borderRadius: 100,
    paddingHorizontal: 14,
    paddingVertical: 6,
    marginTop: 12,
  },
  verdictGreen: { backgroundColor: '#16a34a' },
  verdictAmber: { backgroundColor: '#d97706' },
  verdictText: { color: '#fff', fontSize: 13, fontWeight: '700' },
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
  feasibilityCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#6b7280',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 6,
  },
  feasibilityText: { fontSize: 14, color: '#374151', lineHeight: 20 },
  section: { marginTop: 4 },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 12,
  },
  weakConceptCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 10,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  weakConceptHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  weakConceptTitle: { fontSize: 15, fontWeight: '600', color: '#111827', flex: 1 },
  weakConceptMastery: { fontSize: 15, fontWeight: '700', color: '#dc2626' },
  progressBarBg: {
    height: 6,
    backgroundColor: '#fee2e2',
    borderRadius: 100,
    overflow: 'hidden',
    marginBottom: 6,
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: '#dc2626',
    borderRadius: 100,
  },
  evidenceText: { fontSize: 12, color: '#9ca3af' },
});
