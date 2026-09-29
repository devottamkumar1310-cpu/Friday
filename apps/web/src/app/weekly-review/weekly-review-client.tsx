'use client';

import { useState } from 'react';
import { Card, CardHeader, CardTitle, CardContent, Button } from '@friday/ui';
import { useRouter } from 'next/navigation';

export function WeeklyReviewClient({ data }: { data: any }) {
  const router = useRouter();
  const [acknowledged, setAcknowledged] = useState(false);

  return (
    <div className="space-y-6 mt-6">
      <Card>
        <CardHeader>
          <CardTitle>Your Progress</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-sm font-medium text-muted-foreground">Weighted Progress</p>
              <p className="text-3xl font-semibold">{(data.progressData?.weightedProgress ?? 0).toFixed(2)}</p>
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground">Concepts Mastered</p>
              <p className="text-3xl font-semibold">{data.progressData?.conceptsMastered ?? 0}</p>
            </div>
          </div>
          <p className="mt-4 text-sm">Verdict: {data.progressData?.verdict || 'N/A'}</p>
        </CardContent>
      </Card>

      {data.insightsData?.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Key Insights</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {data.insightsData.map((insight: any, i: number) => (
              <div key={i} className="p-3 border rounded-md">
                <p className="font-medium">{insight.title}</p>
                <p className="text-sm text-muted-foreground mt-1">{insight.body}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {data.weakConceptsData?.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Weak Concepts</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {data.weakConceptsData.map((wc: any, i: number) => (
              <div key={i} className="p-3 border rounded-md flex justify-between items-center">
                <span className="font-medium">Concept {wc.conceptId.slice(0, 8)}...</span>
                <span className="text-sm">Mastery: {wc.mastery?.toFixed(2)}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="pt-6">
          <Button 
            className="w-full" 
            size="lg" 
            onClick={() => {
              setAcknowledged(true);
              setTimeout(() => router.push('/dashboard'), 500);
            }}
            disabled={acknowledged}
          >
            {acknowledged ? 'Acknowledged' : 'Acknowledge Review'}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
