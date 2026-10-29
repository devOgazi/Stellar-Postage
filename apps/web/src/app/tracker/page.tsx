import React, { Suspense } from 'react';
import { TrackerView } from '../../components/TrackerView';

export default function StakeTrackerPage() {
  return (
    <Suspense
      fallback={
        <div className="max-w-2xl mx-auto py-12 text-center text-slate-500">
          Loading tracker...
        </div>
      }
    >
      <TrackerView />
    </Suspense>
  );
}
