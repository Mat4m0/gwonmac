/** Attach the shared decorative frame to a Vue-owned window for its lifetime. */
import { onBeforeUnmount, onMounted, type Ref } from 'vue';
import { attachClassicFrame } from '../../../../src/shared/ui/frame';

export function useClassicFrame(panel: Ref<HTMLElement | null>) {
  let dispose: (() => void) | undefined;
  onMounted(() => { if (panel.value) dispose = attachClassicFrame(panel.value); });
  onBeforeUnmount(() => dispose?.());
}
