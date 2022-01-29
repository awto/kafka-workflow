package org.js.effectful.kafka.workflow;

import java.io.FileInputStream;
import java.io.IOException;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Properties;

import org.apache.kafka.common.serialization.Serdes;
import org.apache.kafka.streams.KafkaStreams;
import org.apache.kafka.streams.StreamsConfig;
import org.apache.kafka.streams.Topology;
import org.apache.kafka.streams.processor.Cancellable;
import org.apache.kafka.streams.processor.PunctuationType;
import org.apache.kafka.streams.processor.api.Processor;
import org.apache.kafka.streams.processor.api.ProcessorContext;
import org.apache.kafka.streams.processor.api.Record;
import org.apache.kafka.streams.state.KeyValueStore;
import org.apache.kafka.streams.state.Stores;

/**
 * Demo-only, not for production time scheduler. Write a record with a 
 * string key "<first part>|<second part>" and a delay value number (in 
 * string format). It will post a record with key "<first part>" and value
 * "<second part>" after the original record timestamp plus the received 
 * delay.
 * 
 * If the delay value is "0" the corresponding job will be canceled.
 */
public class Scheduler {

  public static class SchedulerProcessor implements Processor<String, String, String, String> {
    private ProcessorContext<String, String> context;
    private Cancellable cancel;
    private KeyValueStore<Long, List<String>> fwd;
    private KeyValueStore<String, Long> back;

    public void init(final ProcessorContext<String, String> context) {
      this.context = context;
      cancel = context.schedule(Duration.ofMinutes(1), PunctuationType.WALL_CLOCK_TIME,
          this::punctuate);
      fwd = context.getStateStore("fwd");
      back = context.getStateStore("back");
    }

    public void punctuate(long timestamp) {
      try (final var iter = fwd.range(0L, timestamp)) {
        while (iter.hasNext()) {
          final var susp = iter.next();
          fwd.delete(susp.key);
          for (final var dest : susp.value) {
            final var destAddr = dest.split("\\|");
            context.forward(new Record<String, String>(destAddr[0], destAddr[1], timestamp));
          }
        }
      }
    }

    @Override
    public void process(Record<String, String> record) {
      final var addr = record.key();
      final var valueText = record.value();
      final var param = valueText == null ? 0 : Long.parseLong(valueText);
      if (param == 0) {
        final var timestamp = back.get(addr);
        if (timestamp != null) {
          back.delete(addr);
          final var tup = fwd.get(timestamp);
          if (tup != null) {
            tup.remove(addr);
            if (tup.isEmpty()) {
              fwd.delete(timestamp);
            } else {
              fwd.put(timestamp, tup);
            }
          }
        }
        return;
      }
      final long timestamp = record.timestamp() + param;
      var scheduled = fwd.get(timestamp);
      if (scheduled == null)
        scheduled = new ArrayList<String>();
      scheduled.add(addr);
      fwd.put(timestamp, scheduled);
      back.put(addr, timestamp);
    }

    @Override
    public void close() {
      cancel.cancel();
    }
  }

  static Properties createConfig(final String file) throws IOException {
    final var props = new Properties();
    if (file != null) {
      try (final var fis = new FileInputStream(file)) {
        props.load(fis);
      }
    }
    props.putIfAbsent(StreamsConfig.APPLICATION_ID_CONFIG, "workflow-scheduler");
    props.putIfAbsent(StreamsConfig.BOOTSTRAP_SERVERS_CONFIG, "localhost:9092");
    props.putIfAbsent(StreamsConfig.CACHE_MAX_BYTES_BUFFERING_CONFIG, 0);
    props.putIfAbsent(StreamsConfig.DEFAULT_KEY_SERDE_CLASS_CONFIG, Serdes.String().getClass().getName());
    props.putIfAbsent(StreamsConfig.DEFAULT_VALUE_SERDE_CLASS_CONFIG, Serdes.String().getClass().getName());
    return props;
  }

  public static void main(String[] args) throws IOException {
    final var config = createConfig(args.length > 0 ? args[0] : null);
    final var topology = new Topology();
    topology.addSource("Events", "workflow-scheduler")
        .addProcessor("Process", () -> new SchedulerProcessor(), "Events")
        .addStateStore(Stores.keyValueStoreBuilder(
            Stores.persistentKeyValueStore("back"),
            Serdes.String(),
            Serdes.Long()), "Process")
        .addStateStore(Stores.keyValueStoreBuilder(
            Stores.persistentKeyValueStore("fwd"),
            Serdes.Long(),
            Serdes.ListSerde(ArrayList.class, Serdes.String())), "Process")
        .addSink("Resume", "workflow-resume", "Process");
    final var app = new KafkaStreams(topology, config);
    app.cleanUp();
    Runtime.getRuntime().addShutdownHook(new Thread(app::close));
    app.start();
  }
}
