import React, { Suspense } from 'react';
import { ComposeForm } from '../../components/ComposeForm';

export default function ComposePage() {
  return (
    <Suspense
      fallback={
        <div className="max-w-2xl mx-auto py-12 text-center text-slate-500">
          Loading compose...
        </div>
      }
    >
      <ComposeForm />
    </Suspense>
  );
}
