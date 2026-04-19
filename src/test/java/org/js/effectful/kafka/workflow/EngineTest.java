package org.js.effectful.kafka.workflow;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.IOException;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Collections;
import java.util.regex.Pattern;

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
  private static final String VERSIONED_WORKFLOW = "trip-booking-versioned";
  private static final String ECOMMERCE_VERSIONED_WORKFLOW = "ecommerce-versioned";
  private TopologyTestDriver testDriver;
  private TestInputTopic<String, String> resumeTopic;
  private TestOutputTopic<String, String> resumeLoopTopic;
  private TestOutputTopic<String, String> resultTopic;
  private TestOutputTopic<String, String> errorTopic;
  private TestOutputTopic<String, String> reserveCarTopic;
  private TestOutputTopic<String, String> reserveHotelTopic;
  private TestOutputTopic<String, String> reserveFlightTopic;
  private TestOutputTopic<String, String> reserveTaxiTopic;
  private TestOutputTopic<String, String> cancelCarTopic;
  private TestOutputTopic<String, String> cancelHotelTopic;
  private TestOutputTopic<String, String> cancelFlightTopic;
  private TestOutputTopic<String, String> cancelTaxiTopic;
  private TestOutputTopic<String, String> awaitUpgradeTopic;
  private TestOutputTopic<String, String> awaitRetainTopic;
  private TestOutputTopic<String, String> upgradeDispatchTopic;
  private TestOutputTopic<String, String> handoffTopic;
  private TestOutputTopic<String, String> releaseStartTopic;
  private TestOutputTopic<String, String> releaseCancelTopic;
  private TestOutputTopic<String, String> releaseRetainedTopic;
  private TestOutputTopic<String, String> releaseFiredTopic;
  private TestOutputTopic<String, String> reminderTopic;
  private TestOutputTopic<String, String> discountReminderTopic;
  private TestOutputTopic<String, String> v2ReminderTopic;
  private TestOutputTopic<String, String> approvalRequestTopic;
  private TestOutputTopic<String, String> approvalReminderTopic;
  private TestOutputTopic<String, String> approvalApprovedTopic;
  private TestOutputTopic<String, String> approvalRejectedTopic;
  private TestOutputTopic<String, String> approvalEscalatedTopic;
  private TestOutputTopic<String, String> checkoutErrorTopic;
  private TestOutputTopic<String, String> getCartTopic;
  private TestOutputTopic<String, String> schedulerTopic;

  public void setup(String index) throws IOException {
    final var config = Engine.createConfig(null);
    config.setProperty(Engine.IN_MEMORY_STORE, "true");
    final var topology = Engine.createTopology(index, config);
    testDriver = new TopologyTestDriver(topology, config);
    resumeTopic = testDriver.createInputTopic("workflow-resume", new StringSerializer(), new StringSerializer());
    resumeLoopTopic = testDriver.createOutputTopic("workflow-resume", new StringDeserializer(), new StringDeserializer());
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

  public void setupTripBookingSagaVersioned() throws IOException {
    setup("./src/main/resources/static/built/trip-booking-saga-versioned/index.js");
    reserveCarTopic = testDriver.createOutputTopic("versioned-reserve-car", new StringDeserializer(),
        new StringDeserializer());
    reserveHotelTopic = testDriver.createOutputTopic("versioned-reserve-hotel", new StringDeserializer(),
        new StringDeserializer());
    reserveFlightTopic = testDriver.createOutputTopic("versioned-reserve-flight", new StringDeserializer(),
        new StringDeserializer());
    reserveTaxiTopic = testDriver.createOutputTopic("versioned-reserve-taxi", new StringDeserializer(),
        new StringDeserializer());
    cancelCarTopic = testDriver.createOutputTopic("versioned-cancel-car", new StringDeserializer(),
        new StringDeserializer());
    cancelHotelTopic = testDriver.createOutputTopic("versioned-cancel-hotel", new StringDeserializer(),
        new StringDeserializer());
    cancelFlightTopic = testDriver.createOutputTopic("versioned-cancel-flight", new StringDeserializer(),
        new StringDeserializer());
    cancelTaxiTopic = testDriver.createOutputTopic("versioned-cancel-taxi", new StringDeserializer(),
        new StringDeserializer());
    awaitUpgradeTopic = testDriver.createOutputTopic("versioning-await-upgrade", new StringDeserializer(),
        new StringDeserializer());
    awaitRetainTopic = testDriver.createOutputTopic("versioning-await-retain", new StringDeserializer(),
        new StringDeserializer());
    upgradeDispatchTopic = testDriver.createOutputTopic("versioning-upgrade-dispatch", new StringDeserializer(),
        new StringDeserializer());
    handoffTopic = testDriver.createOutputTopic("versioning-handoff", new StringDeserializer(),
        new StringDeserializer());
    releaseStartTopic = testDriver.createOutputTopic("versioning-release-start", new StringDeserializer(),
        new StringDeserializer());
    releaseCancelTopic = testDriver.createOutputTopic("versioning-release-cancel", new StringDeserializer(),
        new StringDeserializer());
    releaseRetainedTopic = testDriver.createOutputTopic("versioning-release-retained", new StringDeserializer(),
        new StringDeserializer());
    releaseFiredTopic = testDriver.createOutputTopic("versioning-release-fired", new StringDeserializer(),
        new StringDeserializer());
  }

  public void setupEcommerceVersioned() throws IOException {
    setup("./src/main/resources/static/built/ecommerce-versioned/index.js");
    reminderTopic = testDriver.createOutputTopic("ecommerce-reminder", new StringDeserializer(),
        new StringDeserializer());
    discountReminderTopic = testDriver.createOutputTopic("ecommerce-discount-reminder", new StringDeserializer(),
        new StringDeserializer());
    v2ReminderTopic = testDriver.createOutputTopic("ecommerce-v2-reminder", new StringDeserializer(),
        new StringDeserializer());
    checkoutErrorTopic = testDriver.createOutputTopic("checkoutError", new StringDeserializer(),
        new StringDeserializer());
    getCartTopic = testDriver.createOutputTopic("getCart", new StringDeserializer(),
        new StringDeserializer());
    awaitUpgradeTopic = testDriver.createOutputTopic("versioning-await-upgrade", new StringDeserializer(),
        new StringDeserializer());
    upgradeDispatchTopic = testDriver.createOutputTopic("versioning-upgrade-dispatch", new StringDeserializer(),
        new StringDeserializer());
    handoffTopic = testDriver.createOutputTopic("versioning-handoff", new StringDeserializer(),
        new StringDeserializer());
  }

  public void setupExpenseApproval() throws IOException {
    setup("./src/main/resources/static/built/expense-approval/index.js");
    approvalRequestTopic = testDriver.createOutputTopic("expense-approval-request", new StringDeserializer(),
        new StringDeserializer());
    approvalReminderTopic = testDriver.createOutputTopic("expense-approval-reminder", new StringDeserializer(),
        new StringDeserializer());
    approvalApprovedTopic = testDriver.createOutputTopic("expense-approval-approved", new StringDeserializer(),
        new StringDeserializer());
    approvalRejectedTopic = testDriver.createOutputTopic("expense-approval-rejected", new StringDeserializer(),
        new StringDeserializer());
    approvalEscalatedTopic = testDriver.createOutputTopic("expense-approval-escalated", new StringDeserializer(),
        new StringDeserializer());
  }

  private static String stringField(String json, String name) {
    final var matcher = Pattern.compile("\"" + Pattern.quote(name) + "\":\"([^\"]*)\"").matcher(json);
    assertTrue(matcher.find(), "missing field " + name + " in " + json);
    return matcher.group(1);
  }

  private static void assertKinds(List<String> expectedKinds, String... values) {
    final var actualKinds = Arrays.stream(values)
        .map(value -> stringField(value, "kind"))
        .sorted()
        .toList();
    assertEquals(expectedKinds.stream().sorted().toList(), actualKinds);
  }

  private static String schedulerResumePayload(KeyValue<String, String> schedulerRecord) {
    return schedulerRecord.key.split("\\|", 2)[1];
  }

  private void loopbackResumeRecord(KeyValue<String, String> record) {
    resumeTopic.pipeInput(record.key, record.value);
  }

  private void drainResumeLoopTopic() {
    while (!resumeLoopTopic.isEmpty()) {
      loopbackResumeRecord(resumeLoopTopic.readKeyValue());
    }
  }

  private List<String> drainValues(TestOutputTopic<String, String> topic) {
    final var values = new ArrayList<String>();
    while (!topic.isEmpty()) {
      values.add(topic.readValue());
    }
    return values;
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

  @Test
  public void testTripBookingSagaAllResolved() throws IOException {
    setupTripBookingSaga();
    resumeTopic.pipeInput("thread1", "new:{}");
    final var carRef = reserveCarTopic.readValue();
    final var hotelRef = reserveHotelTopic.readValue();
    final var flightRef = reserveFlightTopic.readValue();
    resumeTopic.pipeInput("thread1", String.format("{\"ref\":\"%s\"}", flightRef));
    resumeTopic.pipeInput("thread1", String.format("{\"ref\":\"%s\"}", hotelRef));
    resumeTopic.pipeInput("thread1", String.format("{\"ref\":\"%s\"}", carRef));
    assertEquals(
        new KeyValue<>("thread1", String.format(
            "{\"car\":{\"id\":\"%s\"},\"hotel\":{\"id\":\"%s\"},\"flight\":{\"id\":\"%s\"}}",
            carRef, hotelRef, flightRef)),
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
    final var carRef = reserveCarTopic.readValue();
    final var hotelRef = reserveHotelTopic.readValue();
    final var flightRef = reserveFlightTopic.readValue();
    resumeTopic.pipeInput("thread1", String.format("{\"ref\":\"%s\"}", flightRef));
    resumeTopic.pipeInput("thread1", String.format("{\"ref\":\"%s\"}", carRef));
    resumeTopic.pipeInput("thread1", String.format("{\"ref\":\"%s\"}", hotelRef));
    assertEquals(new KeyValue<>("thread1", carRef), cancelCarTopic.readKeyValue());
    assertEquals(new KeyValue<>("thread1", hotelRef), cancelHotelTopic.readKeyValue());
    assertEquals(new KeyValue<>("thread1", flightRef), cancelFlightTopic.readKeyValue());
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
    final var carRef = reserveCarTopic.readValue();
    final var hotelRef = reserveHotelTopic.readValue();
    final var flightRef = reserveFlightTopic.readValue();
    resumeTopic.pipeInput("thread1", String.format("{\"ref\":\"%s\"}", flightRef));
    resumeTopic.pipeInput("thread1", String.format("{\"ref\":\"%s\"}", carRef));
    resumeTopic.pipeInput("thread1",
        String.format("{\"error\": \"hotel is not available\", \"ref\":\"%s\"}", hotelRef));
    assertEquals(new KeyValue<>("thread1", "\"hotel is not available\""), errorTopic.readKeyValue());
    assertEquals(new KeyValue<>("thread1", carRef), cancelCarTopic.readKeyValue());
    assertEquals(new KeyValue<>("thread1", flightRef), cancelFlightTopic.readKeyValue());
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
    final var carRef = reserveCarTopic.readValue();
    final var hotelRef = reserveHotelTopic.readValue();
    final var flightRef = reserveFlightTopic.readValue();
    resumeTopic.pipeInput("thread1", String.format("{\"ref\":\"%s\"}", flightRef));
    resumeTopic.pipeInput("thread1", String.format("{\"ref\":\"%s\"}", carRef));
    resumeTopic.pipeInput("thread1", schedulerTopic.readKeyValue().key.split("\\|")[1]);
    assertEquals(new KeyValue<>("thread1", "\"timeout\""), errorTopic.readKeyValue());
    assertEquals(new KeyValue<>("thread1", carRef), cancelCarTopic.readKeyValue());
    assertEquals(new KeyValue<>("thread1", hotelRef), cancelHotelTopic.readKeyValue());
    assertEquals(new KeyValue<>("thread1", flightRef), cancelFlightTopic.readKeyValue());
    assertTrue(errorTopic.isEmpty());
    assertTrue(resultTopic.isEmpty());
    assertTrue(cancelCarTopic.isEmpty());
    assertTrue(cancelHotelTopic.isEmpty());
    assertTrue(cancelFlightTopic.isEmpty());
  }

  @Test
  public void testTripBookingSagaVersionedMinorUpgradeToTaxi() throws IOException {
    setupTripBookingSagaVersioned();
    resumeTopic.pipeInput("booking1",
        "new:{\"workflow\":\"trip-booking-versioned\",\"version\":{\"major\":1,\"minor\":0,\"patch\":0},\"kind\":\"start\",\"bookingId\":\"booking1\",\"payload\":{\"releaseAfterMS\":60000}}");
    final var hotel = reserveHotelTopic.readValue();
    final var flight = reserveFlightTopic.readValue();
    final var car = reserveCarTopic.readValue();
    final var upgrade = awaitUpgradeTopic.readValue();
    final var hotelRef = stringField(hotel, "ref");
    final var flightRef = stringField(flight, "ref");
    final var carRef = stringField(car, "ref");
    final var upgradeRef = stringField(upgrade, "ref");

    resumeTopic.pipeInput("booking1", String.format("{\"ref\":\"%s\",\"value\":{\"accepted\":true}}", hotelRef));
    resumeTopic.pipeInput("booking1", String.format("{\"ref\":\"%s\",\"value\":{\"accepted\":true}}", flightRef));
    resumeTopic.pipeInput("upgrade1",
        String.format(
            "new:{\"workflow\":\"versioning-upgrade-manager\",\"command\":{\"workflow\":\"%s\",\"targetVersion\":{\"major\":1,\"minor\":1,\"patch\":0},\"targets\":[{\"bookingId\":\"booking1\",\"ref\":\"%s\"}]}}",
            VERSIONED_WORKFLOW, upgradeRef));
    drainResumeLoopTopic();
    if (!upgradeDispatchTopic.isEmpty()) {
      final var upgradeDispatch = upgradeDispatchTopic.readKeyValue();
      assertEquals("booking1", upgradeDispatch.key);
      assertTrue(upgradeDispatch.value.contains("\"ref\":\"" + upgradeRef + "\""));
    }
    final var result1 = resultTopic.readKeyValue();
    final var result2 = resultTopic.readKeyValue();
    final var managerResult = "upgrade1".equals(result1.key) ? result1 : result2;
    final var upgraded = "booking1".equals(result1.key) ? result1 : result2;
    assertEquals("upgrade1", managerResult.key);
    assertTrue(managerResult.value.contains("\"dispatched\":[\"booking1\"]"));
    assertEquals("booking1", upgraded.key);
    assertTrue(upgraded.value.contains("\"status\":\"upgraded\""));
    assertTrue(upgraded.value.contains("\"toVersion\":{\"major\":1,\"minor\":1,\"patch\":0}"));

    final var canceledCar = cancelCarTopic.readKeyValue();
    assertEquals("booking1", canceledCar.key);
    assertTrue(canceledCar.value.contains("\"ref\":\"" + carRef + "\""));

    final var handoff = handoffTopic.readKeyValue();
    assertEquals("booking1", handoff.key);
    assertTrue(handoff.value.contains("\"kind\":\"handoff\""));

    final var releaseStart1 = releaseStartTopic.readValue();
    final var releaseStart2 = releaseStartTopic.readValue();
    assertKinds(List.of("flight", "hotel"), releaseStart1, releaseStart2);

    drainResumeLoopTopic();

    final var awaitRetain1 = awaitRetainTopic.readValue();
    final var awaitRetain2 = awaitRetainTopic.readValue();
    assertTrue(awaitRetain1.contains("\"bookingId\":\"booking1\""));
    assertTrue(awaitRetain2.contains("\"bookingId\":\"booking1\""));
    assertEquals("60000", schedulerTopic.readValue());
    assertEquals("60000", schedulerTopic.readValue());

    resumeTopic.pipeInput("booking1", "new:" + handoff.value);

    final var releaseCancel1 = releaseCancelTopic.readValue();
    final var releaseCancel2 = releaseCancelTopic.readValue();
    assertKinds(List.of("flight", "hotel"), releaseCancel1, releaseCancel2);

    drainResumeLoopTopic();

    final var schedulerAfterRetain = drainValues(schedulerTopic);
    assertEquals(2, Collections.frequency(schedulerAfterRetain, "0"));
    final var retained1 = releaseRetainedTopic.readValue();
    final var retained2 = releaseRetainedTopic.readValue();
    assertKinds(List.of("flight", "hotel"), retained1, retained2);
    final var retainedResult1 = resultTopic.readKeyValue();
    final var retainedResult2 = resultTopic.readKeyValue();
    assertTrue(retainedResult1.key.startsWith("versioning-release:"));
    assertTrue(retainedResult2.key.startsWith("versioning-release:"));
    assertTrue(retainedResult1.value.contains("\"retained\":\"booking1:"));
    assertTrue(retainedResult2.value.contains("\"retained\":\"booking1:"));

    final var nextCar = reserveCarTopic.readValue();
    assertTrue(nextCar.contains("\"reservationId\":\"booking1:car:v1.1\""));
    resumeTopic.pipeInput("booking1",
        String.format("{\"ref\":\"%s\",\"error\":\"car unavailable\"}", stringField(nextCar, "ref")));

    final var taxi = reserveTaxiTopic.readValue();
    assertTrue(taxi.contains("\"reservationId\":\"booking1:taxi:v1.1\""));
    resumeTopic.pipeInput("booking1",
        String.format("{\"ref\":\"%s\",\"value\":{\"accepted\":true}}", stringField(taxi, "ref")));

    final var finished = resultTopic.readKeyValue();
    assertEquals("booking1", finished.key);
    assertTrue(finished.value.contains("\"version\":{\"major\":1,\"minor\":1,\"patch\":0}"));
    assertTrue(finished.value.contains("\"transport\":{\"kind\":\"taxi\""));
    assertTrue(finished.value.contains("\"reservationId\":\"booking1:taxi:v1.1\""));
    assertTrue(errorTopic.isEmpty());
    assertTrue(cancelHotelTopic.isEmpty());
    assertTrue(cancelFlightTopic.isEmpty());
    assertTrue(cancelTaxiTopic.isEmpty());
    assertTrue(releaseFiredTopic.isEmpty());
  }

  @Test
  public void testTripBookingSagaVersionedDelayedReleaseFires() throws IOException {
    setupTripBookingSagaVersioned();
    final var threadId = "release-timeout";
    resumeTopic.pipeInput(threadId,
        "new:{\"workflow\":\"versioning-delayed-release\",\"command\":{\"bookingId\":\"booking-release\",\"delayMS\":25,\"resource\":{\"kind\":\"hotel\",\"reservationId\":\"booking-release:hotel:v1.0\",\"releaseId\":\"booking-release:hotel:2:release\"}}}");
    final var retain = awaitRetainTopic.readValue();
    assertTrue(retain.contains("\"bookingId\":\"booking-release\""));
    final var scheduler = schedulerTopic.readKeyValue();
    assertEquals("25", scheduler.value);

    resumeTopic.pipeInput(threadId, scheduler.key.split("\\|", 2)[1]);

    final var fired = releaseFiredTopic.readKeyValue();
    assertEquals(threadId, fired.key);
    assertTrue(fired.value.contains("\"bookingId\":\"booking-release\""));
    assertTrue(fired.value.contains("\"kind\":\"hotel\""));
    assertTrue(fired.value.contains("\"releaseId\":\"booking-release:hotel:2:release\""));
    assertTrue(releaseRetainedTopic.isEmpty());
    assertTrue(resultTopic.readValue().contains("\"released\":\"booking-release:hotel:v1.0\""));
  }

  @Test
  public void testTripBookingSagaVersionedMajor2StartsFresh() throws IOException {
    setupTripBookingSagaVersioned();
    resumeTopic.pipeInput("booking2",
        "new:{\"workflow\":\"trip-booking-versioned\",\"version\":{\"major\":2,\"minor\":0,\"patch\":0},\"kind\":\"start\",\"bookingId\":\"booking2\",\"payload\":{\"releaseAfterMS\":60000}}");
    final var hotel = reserveHotelTopic.readValue();
    final var flight = reserveFlightTopic.readValue();
    final var taxi = reserveTaxiTopic.readValue();
    assertTrue(hotel.contains("\"reservationId\":\"booking2:hotel:v2.0\""));
    assertTrue(flight.contains("\"reservationId\":\"booking2:flight:v2.0\""));
    assertTrue(taxi.contains("\"reservationId\":\"booking2:taxi:v2.0\""));
    assertTrue(awaitUpgradeTopic.isEmpty());
    assertTrue(reserveCarTopic.isEmpty());

    resumeTopic.pipeInput("booking2",
        String.format("{\"ref\":\"%s\",\"value\":{\"accepted\":true}}", stringField(hotel, "ref")));
    resumeTopic.pipeInput("booking2",
        String.format("{\"ref\":\"%s\",\"value\":{\"accepted\":true}}", stringField(flight, "ref")));
    resumeTopic.pipeInput("booking2",
        String.format("{\"ref\":\"%s\",\"value\":{\"accepted\":true}}", stringField(taxi, "ref")));

    final var result = resultTopic.readKeyValue();
    assertEquals("booking2", result.key);
    assertTrue(result.value.contains("\"version\":{\"major\":2,\"minor\":0,\"patch\":0}"));
    assertTrue(result.value.contains("\"transport\":{\"kind\":\"taxi\""));
    assertTrue(result.value.contains("\"reservationId\":\"booking2:taxi:v2.0\""));
    assertTrue(errorTopic.isEmpty());
    assertTrue(handoffTopic.isEmpty());
    assertTrue(releaseStartTopic.isEmpty());
  }

  @Test
  public void testEcommerceVersionedMinorUpgradeAddsDiscountReminder() throws IOException {
    setupEcommerceVersioned();
    resumeTopic.pipeInput("cart1",
        "new:{\"workflow\":\"ecommerce-versioned\",\"version\":{\"major\":1,\"minor\":0,\"patch\":0},\"kind\":\"start\",\"bookingId\":\"cart1\",\"payload\":{\"abandonedCartTimeoutMS\":200}}");
    final var upgrade = awaitUpgradeTopic.readKeyValue();
    assertEquals("cart1", upgrade.key);
    assertTrue(upgrade.value.contains("\"ref\":\"main\""));

    final var scheduler = schedulerTopic.readKeyValue();
    assertEquals("200", scheduler.value);

    resumeTopic.pipeInput("cart1",
        "{\"ref\":\"main\",\"value\":{\"type\":\"addToCart\",\"item\":{\"productId\":\"teapot\",\"quantity\":2}}}");
    assertEquals("0", schedulerTopic.readValue());
    assertEquals("200", schedulerTopic.readValue());

    resumeTopic.pipeInput("cart1",
        "{\"ref\":\"main\",\"value\":{\"type\":\"updateEmail\",\"email\":\"cart@example.com\"}}");
    assertEquals("0", schedulerTopic.readValue());
    final var reminderTimeout = schedulerTopic.readKeyValue();
    assertEquals("200", reminderTimeout.value);

    resumeTopic.pipeInput("cart1", reminderTimeout.key.split("\\|", 2)[1]);
    final var reminder = reminderTopic.readKeyValue();
    assertEquals("cart1", reminder.key);
    assertEquals("cart@example.com", reminder.value);

    resumeTopic.pipeInput("cart-upgrade",
        String.format(
            "new:{\"workflow\":\"versioning-upgrade-manager\",\"command\":{\"workflow\":\"%s\",\"targetVersion\":{\"major\":1,\"minor\":1,\"patch\":0},\"targets\":[{\"bookingId\":\"cart1\",\"ref\":\"main\"}]}}",
            ECOMMERCE_VERSIONED_WORKFLOW));
    drainResumeLoopTopic();

    final var upgradeDispatch = upgradeDispatchTopic.readKeyValue();
    assertEquals("cart1", upgradeDispatch.key);
    assertTrue(upgradeDispatch.value.contains("\"ref\":\"main\""));
    assertTrue(upgradeDispatch.value.contains("\"targetVersion\":{\"major\":1,\"minor\":1,\"patch\":0}"));

    final var result1 = resultTopic.readKeyValue();
    final var result2 = resultTopic.readKeyValue();
    final var managerResult = "cart-upgrade".equals(result1.key) ? result1 : result2;
    final var upgraded = "cart1".equals(result1.key) ? result1 : result2;
    assertEquals("cart-upgrade", managerResult.key);
    assertTrue(managerResult.value.contains("\"dispatched\":[\"cart1\"]"));
    assertEquals("cart1", upgraded.key);
    assertTrue(upgraded.value.contains("\"status\":\"upgraded\""));
    assertTrue(upgraded.value.contains("\"toVersion\":{\"major\":1,\"minor\":1,\"patch\":0}"));

    final var handoff = handoffTopic.readKeyValue();
    assertEquals("cart1", handoff.key);
    assertTrue(handoff.value.contains("\"items\":[{\"productId\":\"teapot\",\"quantity\":2}]"));
    assertTrue(handoff.value.contains("\"email\":\"cart@example.com\""));
    assertTrue(handoff.value.contains("\"reminderStage\":1"));

    resumeTopic.pipeInput("cart1", "new:" + handoff.value);
    final var discountTimeout = schedulerTopic.readKeyValue();
    assertEquals("200", discountTimeout.value);

    resumeTopic.pipeInput("cart1", discountTimeout.key.split("\\|", 2)[1]);
    final var discount = discountReminderTopic.readKeyValue();
    assertEquals("cart1", discount.key);
    assertTrue(discount.value.contains("\"email\":\"cart@example.com\""));
    assertTrue(discount.value.contains("\"code\":\"SAVE10\""));

    resumeTopic.pipeInput("cart1", "{\"ref\":\"main\",\"value\":{\"type\":\"checkout\"}}");
    final var finished = resultTopic.readKeyValue();
    assertEquals("cart1", finished.key);
    assertTrue(finished.value.contains("\"version\":{\"major\":1,\"minor\":1,\"patch\":0}"));
    assertTrue(finished.value.contains("\"email\":\"cart@example.com\""));
    assertTrue(finished.value.contains("\"discountCode\":\"SAVE10\""));
    assertTrue(finished.value.contains("\"items\":[{\"productId\":\"teapot\",\"quantity\":2}]"));
    assertTrue(errorTopic.isEmpty());
    assertTrue(checkoutErrorTopic.isEmpty());
    assertTrue(getCartTopic.isEmpty());
  }

  @Test
  public void testEcommerceVersionedMajor2StartsFresh() throws IOException {
    setupEcommerceVersioned();
    resumeTopic.pipeInput("cart2",
        "new:{\"workflow\":\"ecommerce-versioned\",\"version\":{\"major\":2,\"minor\":0,\"patch\":0},\"kind\":\"start\",\"bookingId\":\"cart2\",\"payload\":{\"abandonedCartTimeoutMS\":200}}");
    final var scheduler = schedulerTopic.readKeyValue();
    assertEquals("200", scheduler.value);
    assertTrue(awaitUpgradeTopic.isEmpty());

    resumeTopic.pipeInput("cart2",
        "{\"ref\":\"main\",\"value\":{\"type\":\"addToCart\",\"item\":{\"productId\":\"coffee\",\"quantity\":4}}}");
    assertEquals("0", schedulerTopic.readValue());
    assertEquals("200", schedulerTopic.readValue());

    resumeTopic.pipeInput("cart2",
        "{\"ref\":\"main\",\"value\":{\"type\":\"updateEmail\",\"email\":\"major@example.com\"}}");
    assertEquals("0", schedulerTopic.readValue());
    final var reminderTimeout = schedulerTopic.readKeyValue();
    assertEquals("200", reminderTimeout.value);

    resumeTopic.pipeInput("cart2", reminderTimeout.key.split("\\|", 2)[1]);
    final var reminder = v2ReminderTopic.readKeyValue();
    assertEquals("cart2", reminder.key);
    assertTrue(reminder.value.contains("\"email\":\"major@example.com\""));
    assertTrue(reminder.value.contains("\"channel\":\"sms\""));

    resumeTopic.pipeInput("cart2", "{\"ref\":\"main\",\"value\":{\"type\":\"checkout\"}}");
    final var result = resultTopic.readKeyValue();
    assertEquals("cart2", result.key);
    assertTrue(result.value.contains("\"version\":{\"major\":2,\"minor\":0,\"patch\":0}"));
    assertTrue(result.value.contains("\"email\":\"major@example.com\""));
    assertTrue(result.value.contains("\"channel\":\"v2\""));
    assertTrue(result.value.contains("\"items\":[{\"productId\":\"coffee\",\"quantity\":4}]"));
    assertTrue(handoffTopic.isEmpty());
    assertTrue(checkoutErrorTopic.isEmpty());
    assertTrue(errorTopic.isEmpty());
  }

  @Test
  public void testExpenseApprovalApprovesBeforeDeadline() throws IOException {
    setupExpenseApproval();
    resumeTopic.pipeInput("expense-1",
        "new:{\"amount\":4200,\"requester\":\"alice\",\"approverEmail\":\"lead@example.com\",\"description\":\"Conference travel\",\"approvalTimeoutMS\":250,\"reminderTimeoutMS\":400}");

    final var request = approvalRequestTopic.readKeyValue();
    assertEquals("expense-1", request.key);
    assertTrue(request.value.contains("\"stage\":\"requested\""));
    assertTrue(request.value.contains("\"expenseId\":\"expense-1\""));
    assertEquals("250", schedulerTopic.readValue());

    final var decisionRef = stringField(request.value, "decisionRef");
    resumeTopic.pipeInput("expense-1",
        String.format(
            "{\"ref\":\"%s\",\"value\":{\"type\":\"approve\",\"decidedBy\":\"lead@example.com\",\"comment\":\"Approved\"}}",
            decisionRef));

    final var approved = approvalApprovedTopic.readKeyValue();
    assertEquals("expense-1", approved.key);
    assertTrue(approved.value.contains("\"status\":\"approved\""));
    assertTrue(approved.value.contains("\"stage\":\"requested\""));
    assertEquals("0", schedulerTopic.readValue());
    assertTrue(resultTopic.readValue().contains("\"status\":\"approved\""));
    assertTrue(approvalReminderTopic.isEmpty());
    assertTrue(approvalEscalatedTopic.isEmpty());
    assertTrue(errorTopic.isEmpty());
  }

  @Test
  public void testExpenseApprovalRemindsThenRejects() throws IOException {
    setupExpenseApproval();
    resumeTopic.pipeInput("expense-2",
        "new:{\"amount\":1800,\"requester\":\"bob\",\"approverEmail\":\"manager@example.com\",\"approvalTimeoutMS\":200,\"reminderTimeoutMS\":250}");

    final var request = approvalRequestTopic.readKeyValue();
    assertEquals("expense-2", request.key);
    final var firstTimer = schedulerTopic.readKeyValue();
    assertEquals("200", firstTimer.value);

    resumeTopic.pipeInput("expense-2", schedulerResumePayload(firstTimer));

    final var reminder = approvalReminderTopic.readKeyValue();
    assertEquals("expense-2", reminder.key);
    assertTrue(reminder.value.contains("\"stage\":\"reminded\""));
    final var secondTimer = schedulerTopic.readKeyValue();
    assertEquals("250", secondTimer.value);

    resumeTopic.pipeInput("expense-2",
        String.format(
            "{\"ref\":\"%s\",\"value\":{\"type\":\"reject\",\"decidedBy\":\"manager@example.com\",\"comment\":\"Budget frozen\"}}",
            stringField(reminder.value, "decisionRef")));

    final var rejected = approvalRejectedTopic.readKeyValue();
    assertEquals("expense-2", rejected.key);
    assertTrue(rejected.value.contains("\"status\":\"rejected\""));
    assertTrue(rejected.value.contains("\"stage\":\"reminded\""));
    assertEquals("0", schedulerTopic.readValue());
    assertTrue(resultTopic.readValue().contains("\"status\":\"rejected\""));
    assertTrue(approvalEscalatedTopic.isEmpty());
    assertTrue(errorTopic.isEmpty());
  }

  @Test
  public void testExpenseApprovalEscalatesAfterTwoTimeouts() throws IOException {
    setupExpenseApproval();
    resumeTopic.pipeInput("expense-3",
        "new:{\"amount\":15000,\"requester\":\"dana\",\"approverEmail\":\"director@example.com\",\"description\":\"Team offsite\",\"approvalTimeoutMS\":200,\"reminderTimeoutMS\":250}");

    final var request = approvalRequestTopic.readKeyValue();
    assertEquals("expense-3", request.key);
    final var firstTimer = schedulerTopic.readKeyValue();
    assertEquals("200", firstTimer.value);

    resumeTopic.pipeInput("expense-3", schedulerResumePayload(firstTimer));

    final var reminder = approvalReminderTopic.readKeyValue();
    assertEquals("expense-3", reminder.key);
    final var secondTimer = schedulerTopic.readKeyValue();
    assertEquals("250", secondTimer.value);

    resumeTopic.pipeInput("expense-3", schedulerResumePayload(secondTimer));

    final var escalated = approvalEscalatedTopic.readKeyValue();
    assertEquals("expense-3", escalated.key);
    assertTrue(escalated.value.contains("\"status\":\"escalated\""));
    assertTrue(escalated.value.contains("\"stage\":\"reminded\""));
    assertTrue(resultTopic.readValue().contains("\"status\":\"escalated\""));
    assertTrue(approvalApprovedTopic.isEmpty());
    assertTrue(approvalRejectedTopic.isEmpty());
    assertTrue(errorTopic.isEmpty());
  }

}
