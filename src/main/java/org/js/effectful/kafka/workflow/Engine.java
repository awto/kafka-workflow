package org.js.effectful.kafka.workflow;

import java.io.FileInputStream;
import java.io.FileNotFoundException;
import java.io.FileReader;
import java.io.IOException;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Properties;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CountDownLatch;

import org.apache.kafka.common.serialization.Serdes;
import org.apache.kafka.streams.KafkaStreams;
import org.apache.kafka.streams.StreamsConfig;
import org.apache.kafka.streams.Topology;
import org.apache.kafka.streams.processor.api.Processor;
import org.apache.kafka.streams.processor.api.ProcessorContext;
import org.apache.kafka.streams.processor.api.Record;
import org.apache.kafka.streams.state.KeyValueStore;
import org.apache.kafka.streams.state.Stores;
import org.graalvm.polyglot.Context;
import org.graalvm.polyglot.HostAccess;
import org.graalvm.polyglot.Source;
import org.graalvm.polyglot.Value;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Kafka stream for running JS workflows as code.
 * 
 * Expects path to the script as a first command line argument and an optional
 * properties file for
 * Kafka streams initialization as its second argument.
 */
public class Engine {

  private static String NEW_THREAD_PREFIX = "new:";
  public static String IN_MEMORY_STORE = "workflow.store.in-memory";
  private static final Logger log = LoggerFactory.getLogger(Engine.class);

  static Properties createConfig(final String file) throws IOException {
    final var props = new Properties();
    if (file != null) {
      try (final var fis = new FileInputStream(file)) {
        props.load(fis);
      }
    }
    props.putIfAbsent(StreamsConfig.APPLICATION_ID_CONFIG, "workflow-engine");
    props.putIfAbsent(StreamsConfig.BOOTSTRAP_SERVERS_CONFIG, "localhost:9092");
    props.putIfAbsent(StreamsConfig.CACHE_MAX_BYTES_BUFFERING_CONFIG, 0);
    props.putIfAbsent(StreamsConfig.DEFAULT_KEY_SERDE_CLASS_CONFIG, Serdes.String().getClass().getName());
    props.putIfAbsent(StreamsConfig.DEFAULT_VALUE_SERDE_CLASS_CONFIG, Serdes.String().getClass().getName());
    return props;
  }

  private static class JoinProcessor implements Processor<String, String, String, String> {

    private KeyValueStore<String, String> store;
    private ProcessorContext<String, String> context;
    private Value step;
    private Context jsContext;
    private Source source;

    JoinProcessor(final Source source) {
      this.source = source;
    }

    public void init(final ProcessorContext<String, String> context) {
      store = context.getStateStore("store");
      this.context = context;
      jsContext = createScriptContext(source);
      step = jsContext.eval("js", "efwf$step");
    }

    public void process(Record<String, String> record) {
      final var threadId = record.key();
      String state = null;
      var resume = record.value();
      final var newThread = resume.startsWith(NEW_THREAD_PREFIX);
      if (newThread)
        resume = resume.substring(NEW_THREAD_PREFIX.length());
      else {
        state = store.get(threadId);
        if (state == null) {
          log.warn("not available thread {}", threadId);
          return;
        }
      }
      try {
        final var future = new CompletableFuture<List<List<String>>>();
        final var metadata = context.recordMetadata().get();
        step.executeVoid(resume, state, threadId,
            Long.toString(metadata.offset()), future);
        final var result = future.join();
        final var res = result.remove(0).get(0);
        if (res == null || res.isEmpty())
          store.delete(threadId);
        else
          store.put(threadId, res);
        for (final var i : result)
          context.forward(record.withKey(i.get(0)).withValue(i.get(1)), i.get(2));
      } catch (Throwable e) {
        log.error("workflow step error", e);
      }
    }

    @Override
    public void close() {
      jsContext.close();
    }

  }

  public static Topology createTopology(final String index, final Properties config)
      throws FileNotFoundException, IOException {
    final var topology = new Topology();
    final var source = Source.newBuilder("js", new FileReader(index), "index.js").build();
    try (final var context = createScriptContext(source)) {
      topology.addSource("Loop", "workflow-resume")
          .addProcessor("Process", () -> new JoinProcessor(source), "Loop")
          .addStateStore(Stores.keyValueStoreBuilder(
              Boolean.parseBoolean(config.getProperty(IN_MEMORY_STORE)) ? Stores.inMemoryKeyValueStore("store")
                  : Stores.persistentKeyValueStore("store"),
              Serdes.String(),
              Serdes.String()), "Process")
          .addSink("workflow-resume", "workflow-resume", "Process");
      final var outputTopics = new ArrayList<String>();
      context.eval("js", "efwf$outputTopics").execute(outputTopics);
      for (var i : outputTopics)
        topology.addSink(i, i, "Process");
    }
    return topology;
  }

  public static Context createScriptContext(final Source source) {
    final Map<String, String> options = new HashMap<>();
    options.put("js.esm-eval-returns-exports", "true");
    options.put("js.java-package-globals", "true");
    final var context = Context.newBuilder("js")
        .allowHostAccess(HostAccess.ALL)
        .allowHostClassLookup(className -> true)
        .allowIO(true)
        .allowExperimentalOptions(true)
        .options(options)
        .build();
    try {
      context.eval(source);
      return context;
    } catch (Exception e) {
      context.close();
      log.error("create scripting context error", e);
      throw e;
    }
  }

  public static void main(String[] args) throws Exception {
    if (args.length == 0) {
      System.out.println("command line arguments: <workflow's index.js> [<properties file>]");
      System.exit(1);
    }
    final var config = createConfig(args.length > 1 ? args[1] : null);
    final var topology = createTopology(args[0], config);
    final var app = new KafkaStreams(topology, config);
    final var latch = new CountDownLatch(1);
    Runtime.getRuntime().addShutdownHook(new Thread("streams-shutdown-hook") {
      @Override
      public void run() {
        app.close();
        latch.countDown();
      }
    });
    try {
      app.start();
      latch.await();
    } catch (Throwable e) {
      System.exit(1);
    }
    System.exit(0);
  }
}
