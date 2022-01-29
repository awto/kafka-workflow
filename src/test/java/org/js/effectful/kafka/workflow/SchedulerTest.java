package org.js.effectful.kafka.workflow;

import static org.junit.jupiter.api.Assertions.assertIterableEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.ArrayList;
import java.util.List;

import org.apache.kafka.common.serialization.Serdes;
import org.apache.kafka.streams.processor.api.MockProcessorContext;
import org.apache.kafka.streams.processor.api.Record;
import org.apache.kafka.streams.state.Stores;
import org.junit.jupiter.api.Test;

/**
 * Unit test of {@link Scheduler} stream using TopologyTestDriver.
 */
public class SchedulerTest {
  @Test
  public void test() {
    final var context = new MockProcessorContext<String, String>();
    final var backStore = Stores.keyValueStoreBuilder(Stores.inMemoryKeyValueStore("back"),
        Serdes.String(), Serdes.Long()).withLoggingDisabled().build();
    final var fwdStore = Stores.keyValueStoreBuilder(Stores.inMemoryKeyValueStore("fwd"),
        Serdes.Long(),
        Serdes.ListSerde(ArrayList.class, Serdes.String())).withLoggingDisabled().build();
    backStore.init(context.getStateStoreContext(), backStore);
    fwdStore.init(context.getStateStoreContext(), fwdStore);
    final var processor = new Scheduler.SchedulerProcessor();
    processor.init(context);
    processor.process(new Record<>("t1|r1", "1000", 0L));
    processor.process(new Record<>("t1|r2", "2000", 0L));
    processor.process(new Record<>("t1|r1", "0", 0L));
    assertTrue(context.forwarded().isEmpty());
    context.scheduledPunctuators().get(0).getPunctuator().punctuate(3000L);
    final var forwarded = context.forwarded();
    final var expected = List.of(new MockProcessorContext.CapturedForward<>(new Record<>("t1", "r2", 3000L)));
    assertIterableEquals(expected, forwarded);
  }

}