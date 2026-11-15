'use client';

import { Checkbox } from '@aeolus-fleet/ui';
import { useEffect, useRef, useState, type ComponentProps } from 'react';

/**
 * The shared Checkbox as a form's field. React 19 resets a form once its
 * action ends, refused or not, while the shared Checkbox keeps its own ticked
 * state: on the form's reset this box starts again from defaultChecked, so
 * the tick shown is the value the form sends.
 */
export function FormCheckbox(props: Omit<ComponentProps<typeof Checkbox>, 'ref'>) {
  const box = useRef<HTMLElement>(null);
  const [resets, setResets] = useState(0);
  useEffect(() => {
    const form = box.current?.closest('form');
    if (form === null || form === undefined) {
      return undefined;
    }
    const startAgain = () => {
      setResets((count) => count + 1);
    };
    form.addEventListener('reset', startAgain);
    return () => {
      form.removeEventListener('reset', startAgain);
    };
  }, []);
  return <Checkbox key={resets} ref={box} {...props} />;
}
