package org.js.effectful.kafka.workflow;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.IOException;

import org.apache.kafka.common.serialization.StringDeserializer;
import org.apache.kafka.common.serialization.StringSerializer;
import org.apache.kafka.streams.KeyValue;
import org.apache.kafka.streams.TestInputTopic;
import org.apache.kafka.streams.TestOutputTopic;
import org.apache.kafka.streams.TopologyTestDriver;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

/**
 * Unit test of {@link Engine} stream using TopologyTestDriver.
 */
public class EngineTest {
  private TopologyTestDriver testDriver;
  private TestInputTopic<String, String> resumeTopic;
  private TestOutputTopic<String, String> resultTopic;
  private TestOutputTopic<String, String> errorTopic;
  private TestOutputTopic<String, String> reserveCarTopic;
  private TestOutputTopic<String, String> reserveHotelTopic;
  private TestOutputTopic<String, String> reserveFlightTopic;
  private TestOutputTopic<String, String> cancelCarTopic;
  private TestOutputTopic<String, String> cancelHotelTopic;
  private TestOutputTopic<String, String> cancelFlightTopic;
  private TestOutputTopic<String, String> schedulerTopic;

  public void setup(String index) throws IOException {
    final var config = Engine.createConfig(null);
    config.setProperty(Engine.IN_MEMORY_STORE, "true");
    final var topology = Engine.createTopology(index, config);
    testDriver = new TopologyTestDriver(topology, config);
    resumeTopic = testDriver.createInputTopic("workflow-resume", new StringSerializer(), new StringSerializer());
    resultTopic = testDriver.createOutputTopic("workflow-result", new StringDeserializer(), new StringDeserializer());
    errorTopic = testDriver.createOutputTopic("workflow-error", new StringDeserializer(), new StringDeserializer());
    schedulerTopic = testDriver.createOutputTopic("workflow-scheduler", new StringDeserializer(),
        new StringDeserializer());
  }

  public void setupTripBookingSaga() throws IOException {
    setup("./src/main/resources/static/built/trip-booking-saga/index.js");
    reserveCarTopic = testDriver.createOutputTopic("saga-reserve-car", new StringDeserializer(),
        new StringDeserializer());
    reserveHotelTopic = testDriver.createOutputTopic("saga-reserve-hotel", new StringDeserializer(),
        new StringDeserializer());
    reserveFlightTopic = testDriver.createOutputTopic("saga-reserve-flight", new StringDeserializer(),
        new StringDeserializer());
    cancelCarTopic = testDriver.createOutputTopic("saga-cancel-car", new StringDeserializer(),
        new StringDeserializer());
    cancelHotelTopic = testDriver.createOutputTopic("saga-cancel-hotel", new StringDeserializer(),
        new StringDeserializer());
    cancelFlightTopic = testDriver.createOutputTopic("saga-cancel-flight", new StringDeserializer(),
        new StringDeserializer());
  }

  @AfterEach
  public void tearDown() {
    try {
      testDriver.close();
    } catch (final RuntimeException e) {
      // https://issues.apache.org/jira/browse/KAFKA-6647 causes exception when
      // executed in Windows, ignoring it
      // Logged stacktrace cannot be avoided
      System.out.println("Ignoring exception, test failing in Windows due this exception:" + e.getLocalizedMessage());
    }
  }

  /**
   * Running a simple ecommerce workflow
   */
  @Test
  public void testECommerce() throws IOException {
    setup("./src/main/resources/static/built/ecommerce/index.js");
    resumeTopic.pipeInput("thread1", "new:{\"abandonedCartTimeoutMS\":2000}");
    resumeTopic.pipeInput("thread1",
        "{\"value\":{\"type\":\"updateEmail\",\"email\":\"someone@example.com\"}, \"ref\":\"main\"}");
    resumeTopic.pipeInput("thread1",
        "{\"value\":{\"type\":\"addToCart\",\"item\":{\"quantity\":10,\"productId\":\"teapot\"}}, \"ref\":\"main\"}");
    resumeTopic.pipeInput("thread2", "new:{\"abandonedCartTimeoutMS\":1000}");
    resumeTopic.pipeInput("thread2",
        "{\"value\":{\"type\":\"updateEmail\",\"email\":\"vitaliy.akimov@gmail.com\"}, \"ref\":\"main\"}");
    resumeTopic.pipeInput("thread1",
        "{\"value\":{\"type\":\"addToCart\",\"item\":{\"quantity\":11,\"productId\":\"sigar\"}}, \"ref\":\"main\"}");
    resumeTopic.pipeInput("thread1",
        "{\"value\":{\"type\":\"addToCart\",\"item\":{\"quantity\":20,\"productId\":\"teapot\"}}, \"ref\":\"main\"}");
    resumeTopic.pipeInput("thread1",
        "{\"value\":{\"type\":\"updateEmail\",\"email\":\"vitaliy.akimov@gmail.com\"}, \"ref\":\"main\"}");
    resumeTopic.pipeInput("thread1",
        "{\"value\":{\"type\":\"removeFromCart\", \"item\":{\"quantity\":11,\"productId\":\"sigar\"}}, \"ref\":\"main\"}");
    resumeTopic.pipeInput("thread1",
        "{\"value\":{\"type\":\"addToCart\",\"item\":{\"quantity\":2,\"productId\":\"sugar\"}}, \"ref\":\"main\"}");
    resumeTopic.pipeInput("thread1", "{\"value\":{\"type\":\"checkout\"}, \"ref\":\"main\"}");
    final var result = resultTopic.readKeyValue();
    assertEquals("thread1", result.key);
    assertEquals(
        "{\"items\":[{\"quantity\":30,\"productId\":\"teapot\"},{\"quantity\":2,\"productId\":\"sugar\"}],\"email\":\"vitaliy.akimov@gmail.com\"}",
        result.value);
    assertTrue(resultTopic.isEmpty());
    assertTrue(errorTopic.isEmpty());
  }

  @Test
  public void testTripBookingSagaAllResolved() throws IOException {
    setupTripBookingSaga();
    resumeTopic.pipeInput("thread1", "new:{}");
    resumeTopic.pipeInput("thread1", String.format("{\"ref\":\"%s\"}", reserveFlightTopic.readValue()));
    resumeTopic.pipeInput("thread1", String.format("{\"ref\":\"%s\"}", reserveHotelTopic.readValue()));
    resumeTopic.pipeInput("thread1", String.format("{\"ref\":\"%s\"}", reserveCarTopic.readValue()));
    assertEquals(
        new KeyValue<>("thread1", "{\"car\":{\"id\":\"0:1\"},\"hotel\":{\"id\":\"0:2\"},\"flight\":{\"id\":\"0:3\"}}"),
        resultTopic.readKeyValue());
    assertTrue(resultTopic.isEmpty());
    assertTrue(cancelCarTopic.isEmpty());
    assertTrue(cancelHotelTopic.isEmpty());
    assertTrue(cancelFlightTopic.isEmpty());
  }

  @Test
  public void testTripBookingSagaErrorInCode() throws IOException {
    setupTripBookingSaga();
    resumeTopic.pipeInput("thread1", "new:{\"throwAfterHotel\":true}");
    resumeTopic.pipeInput("thread1", String.format("{\"ref\":\"%s\"}", reserveFlightTopic.readValue()));
    resumeTopic.pipeInput("thread1", String.format("{\"ref\":\"%s\"}", reserveCarTopic.readValue()));
    resumeTopic.pipeInput("thread1", String.format("{\"ref\":\"%s\"}", reserveHotelTopic.readValue()));
    assertEquals(new KeyValue<>("thread1", "0:1"), cancelCarTopic.readKeyValue());
    assertEquals(new KeyValue<>("thread1", "0:2"), cancelHotelTopic.readKeyValue());
    assertEquals(new KeyValue<>("thread1", "0:3"), cancelFlightTopic.readKeyValue());
    assertEquals(new KeyValue<>("thread1", "\"something is wrong\""), errorTopic.readKeyValue());
    assertTrue(errorTopic.isEmpty());
    assertTrue(resultTopic.isEmpty());
    assertTrue(cancelCarTopic.isEmpty());
    assertTrue(cancelHotelTopic.isEmpty());
    assertTrue(cancelFlightTopic.isEmpty());
  }

  @Test
  public void testTripBookingSagaOneErrored() throws IOException {
    setupTripBookingSaga();
    resumeTopic.pipeInput("thread1", "new:{}");
    resumeTopic.pipeInput("thread1", String.format("{\"ref\":\"%s\"}", reserveFlightTopic.readValue()));
    resumeTopic.pipeInput("thread1", String.format("{\"ref\":\"%s\"}", reserveCarTopic.readValue()));
    resumeTopic.pipeInput("thread1",
        String.format("{\"error\": \"hotel is not available\", \"ref\":\"%s\"}", reserveHotelTopic.readValue()));
    assertEquals(new KeyValue<>("thread1", "\"hotel is not available\""), errorTopic.readKeyValue());
    assertEquals(new KeyValue<>("thread1", "0:1"), cancelCarTopic.readKeyValue());
    assertEquals(new KeyValue<>("thread1", "0:3"), cancelFlightTopic.readKeyValue());
    assertTrue(errorTopic.isEmpty());
    assertTrue(resultTopic.isEmpty());
    assertTrue(cancelCarTopic.isEmpty());
    assertTrue(cancelHotelTopic.isEmpty());
    assertTrue(cancelFlightTopic.isEmpty());
  }

  @Test
  public void testTripBookingSagaTimeout() throws IOException {
    setupTripBookingSaga();
    resumeTopic.pipeInput("thread1", "new:{}");
    resumeTopic.pipeInput("thread1", String.format("{\"ref\":\"%s\"}", reserveFlightTopic.readValue()));
    resumeTopic.pipeInput("thread1", String.format("{\"ref\":\"%s\"}", reserveCarTopic.readValue()));
    resumeTopic.pipeInput("thread1", schedulerTopic.readKeyValue().key.split("\\|")[1]);
    assertEquals(new KeyValue<>("thread1", "\"timeout\""), errorTopic.readKeyValue());
    assertEquals(new KeyValue<>("thread1", "0:1"), cancelCarTopic.readKeyValue());
    assertEquals(new KeyValue<>("thread1", "0:2"), cancelHotelTopic.readKeyValue());
    assertEquals(new KeyValue<>("thread1", "0:3"), cancelFlightTopic.readKeyValue());
    assertTrue(errorTopic.isEmpty());
    assertTrue(resultTopic.isEmpty());
    assertTrue(cancelCarTopic.isEmpty());
    assertTrue(cancelHotelTopic.isEmpty());
    assertTrue(cancelFlightTopic.isEmpty());
  }

}
