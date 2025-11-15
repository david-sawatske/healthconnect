import React, { useEffect, useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Modal,
  FlatList,
} from "react-native";
import { useRoute, useNavigation } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { generateClient } from "aws-amplify/api";
import { getCurrentUser } from "aws-amplify/auth";

const client = generateClient();

const log = (...args) => console.log("[PATIENT_DETAIL]", ...args);

const LIST_MY_CONVERSATIONS = /* GraphQL */ `
  query ListMyConversations($sub: String!, $limit: Int, $nextToken: String) {
    listConversations(
      filter: { memberIds: { contains: $sub } }
      limit: $limit
      nextToken: $nextToken
    ) {
      items {
        id
        title
        memberIds
        createdAt
      }
      nextToken
    }
  }
`;

const CREATE_CONVERSATION = /* GraphQL */ `
  mutation CreateConversation($input: CreateConversationInput!) {
    createConversation(input: $input) {
      id
      title
      memberIds
      createdAt
    }
  }
`;

const LIST_ADVOCATE_USERS = /* GraphQL */ `
  query ListAdvocateUsers {
    listUsers(filter: { role: { eq: ADVOCATE } }) {
      items {
        id
        displayName
        email
        role
      }
    }
  }
`;

const ADVOCATE_ASSIGNMENTS_BY_PATIENT = /* GraphQL */ `
  query AdvocateAssignmentsByPatient($patientId: ID!, $limit: Int) {
    advocateAssignmentsByPatient(
      patientId: $patientId
      sortDirection: DESC
      limit: $limit
    ) {
      items {
        id
        patientId
        providerId
        advocateId
        active
        createdAt
      }
    }
  }
`;

const CREATE_ADVOCATE_ASSIGNMENT = /* GraphQL */ `
  mutation CreateAdvocateAssignment($input: CreateAdvocateAssignmentInput!) {
    createAdvocateAssignment(input: $input) {
      id
      patientId
      providerId
      advocateId
      active
      createdAt
    }
  }
`;

const GET_USER = /* GraphQL */ `
  query GetUser($id: ID!) {
    getUser(id: $id) {
      id
      displayName
      role
    }
  }
`;

const CREATE_MESSAGE = /* GraphQL */ `
  mutation CreateMessage($input: CreateMessageInput!) {
    createMessage(input: $input) {
      id
    }
  }
`;

async function safeGql({ query, variables = {}, label }) {
  try {
    const res = await client.graphql({
      query,
      variables,
      authMode: "userPool",
    });
    log(label || "GQL", "OK", JSON.stringify(res?.data)?.slice(0, 240));
    return res;
  } catch (err) {
    log(label || "GQL", "ERR", err);
    throw err;
  }
}

async function getOrCreateProviderPatientConversation({
  providerSub,
  patientId,
}) {
  const listRes = await client.graphql({
    query: LIST_MY_CONVERSATIONS,
    variables: { sub: providerSub, limit: 50 },
    authMode: "userPool",
  });

  const items = listRes?.data?.listConversations?.items || [];

  const existing = items.find(
    (conv) =>
      Array.isArray(conv.memberIds) && conv.memberIds.includes(patientId),
  );
  if (existing) return existing;

  const createRes = await client.graphql({
    query: CREATE_CONVERSATION,
    variables: {
      input: {
        title: "Patient ↔ Provider Chat",
        memberIds: [providerSub, patientId],
      },
    },
    authMode: "userPool",
  });

  return createRes?.data?.createConversation;
}

const PatientDetailScreen = () => {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const route = useRoute();
  const { patientId, patientName } = route.params || {};

  const [providerSub, setProviderSub] = useState(null);

  const [loadingAssignment, setLoadingAssignment] = useState(true);
  const [advocateAssignment, setAdvocateAssignment] = useState(null);
  const [advocateUser, setAdvocateUser] = useState(null);

  const [advocates, setAdvocates] = useState([]);
  const [advocatesLoading, setAdvocatesLoading] = useState(false);
  const [advocatePickerVisible, setAdvocatePickerVisible] = useState(false);
  const [assigning, setAssigning] = useState(false);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const user = await getCurrentUser();
        if (!mounted) return;
        const sub = user?.userId || user?.username;
        setProviderSub(sub);
      } catch (e) {
        log("getCurrentUser ERR", e);
        Alert.alert("Error", "Could not load current user.");
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!patientId) return;

    let mounted = true;
    (async () => {
      setLoadingAssignment(true);
      try {
        const res = await safeGql({
          query: ADVOCATE_ASSIGNMENTS_BY_PATIENT,
          variables: { patientId, limit: 1 },
          label: "AdvocateAssignmentsByPatient",
        });

        const items = res?.data?.advocateAssignmentsByPatient?.items || [];
        const latestActive = items.find((a) => a.active) || items[0] || null;
        if (!mounted) return;

        setAdvocateAssignment(latestActive || null);

        if (latestActive?.advocateId) {
          const userRes = await safeGql({
            query: GET_USER,
            variables: { id: latestActive.advocateId },
            label: "GetAdvocateUser",
          });
          if (!mounted) return;
          setAdvocateUser(userRes?.data?.getUser || null);
        } else {
          setAdvocateUser(null);
        }
      } catch (e) {
        if (!mounted) return;
        log("Load advocate assignment ERR", e);
      } finally {
        if (mounted) setLoadingAssignment(false);
      }
    })();

    return () => {
      mounted = false;
    };
  }, [patientId]);

  const openAdvocatePicker = useCallback(async () => {
    setAdvocatePickerVisible(true);
    if (advocates.length > 0) return;

    setAdvocatesLoading(true);
    try {
      const res = await safeGql({
        query: LIST_ADVOCATE_USERS,
        variables: {},
        label: "ListAdvocateUsers",
      });
      const items = res?.data?.listUsers?.items || [];
      setAdvocates(items);
    } catch (e) {
      log("ListAdvocateUsers ERR", e);
      Alert.alert("Error", "Failed to load advocates.");
    } finally {
      setAdvocatesLoading(false);
    }
  }, [advocates.length]);

  const handleAssignAdvocate = useCallback(
    async (selectedAdvocate) => {
      if (!providerSub) {
        Alert.alert("Error", "Provider not loaded yet.");
        return;
      }

      setAssigning(true);
      try {
        const res = await safeGql({
          query: CREATE_ADVOCATE_ASSIGNMENT,
          variables: {
            input: {
              patientId,
              providerId: providerSub,
              advocateId: selectedAdvocate.id,
              active: true,
            },
          },
          label: "CreateAdvocateAssignment",
        });

        const newAssignment = res?.data?.createAdvocateAssignment;
        setAdvocateAssignment(newAssignment);
        setAdvocateUser(selectedAdvocate);
        setAdvocatePickerVisible(false);
      } catch (e) {
        log("Assign advocate ERR", e);
        Alert.alert("Error", "Failed to assign advocate.");
      } finally {
        setAssigning(false);
      }
    },
    [patientId, providerSub],
  );

  const goToChat = async () => {
    if (!providerSub || !patientId) {
      Alert.alert("Error", "Missing provider or patient info.");
      return;
    }

    try {
      const conversation = await getOrCreateProviderPatientConversation({
        providerSub,
        patientId,
      });

      if (!conversation) {
        Alert.alert("Error", "Could not open conversation.");
        return;
      }

      navigation.navigate("Chat", { conversation });
    } catch (err) {
      log("goToChat ERR", err);
      Alert.alert("Error", "Unable to open conversation.");
    }
  };

  const renderAdvocateSection = () => {
    if (loadingAssignment) {
      return (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Advocate support</Text>
          <ActivityIndicator />
        </View>
      );
    }

    const hasAdvocate = !!advocateUser;

    return (
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Advocate support</Text>

        {hasAdvocate ? (
          <>
            <Text style={styles.cardText}>
              Advocate:{" "}
              <Text style={styles.bold}>
                {advocateUser.displayName || "Assigned advocate"}
              </Text>
            </Text>
            <TouchableOpacity
              style={styles.secondaryButton}
              onPress={openAdvocatePicker}
              disabled={assigning}
            >
              <Text style={styles.secondaryButtonText}>
                {assigning ? "Updating..." : "Change Advocate"}
              </Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            <Text style={styles.cardText}>No advocate assigned.</Text>
            <TouchableOpacity
              style={styles.primaryButton}
              onPress={openAdvocatePicker}
              disabled={assigning}
            >
              <Text style={styles.primaryButtonText}>
                {assigning ? "Assigning..." : "Assign Advocate"}
              </Text>
            </TouchableOpacity>
          </>
        )}
      </View>
    );
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>
          {patientName || "Patient Detail"}
        </Text>
      </View>

      <View style={styles.content}>
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Patient overview</Text>
          <Text style={styles.cardText}>
            ID: <Text style={styles.mono}>{patientId}</Text>
          </Text>

          <TouchableOpacity style={styles.secondaryButton} onPress={goToChat}>
            <Text style={styles.secondaryButtonText}>Open Chat</Text>
          </TouchableOpacity>
        </View>

        {renderAdvocateSection()}
      </View>

      <AdvocatePickerModal
        visible={advocatePickerVisible}
        onClose={() => setAdvocatePickerVisible(false)}
        advocates={advocates}
        loading={advocatesLoading}
        onSelect={handleAssignAdvocate}
      />
    </View>
  );
};

const AdvocatePickerModal = ({
  visible,
  onClose,
  advocates,
  loading,
  onSelect,
}) => {
  const [selectedAdvocateId, setSelectedAdvocateId] = useState(null);

  useEffect(() => {
    if (!visible) setSelectedAdvocateId(null);
  }, [visible]);

  const handleConfirm = () => {
    const advocate = advocates.find((a) => a.id === selectedAdvocateId);
    if (!advocate) {
      Alert.alert("Select an advocate", "Please choose an advocate first.");
      return;
    }
    onSelect(advocate);
  };

  const renderItem = ({ item }) => {
    const selected = item.id === selectedAdvocateId;
    return (
      <TouchableOpacity
        style={[styles.advocateRow, selected && styles.advocateRowSelected]}
        onPress={() => setSelectedAdvocateId(item.id)}
      >
        <Text style={styles.advocateName}>
          {item.displayName || "Unnamed Advocate"}
        </Text>
        {selected && <Text style={styles.advocateSelectedMark}>✓</Text>}
      </TouchableOpacity>
    );
  };

  return (
    <Modal visible={visible} transparent animationType="slide">
      <View style={styles.modalOverlay}>
        <View style={styles.modalContent}>
          <Text style={styles.modalTitle}>Assign Advocate</Text>

          {loading ? (
            <ActivityIndicator style={{ marginVertical: 16 }} />
          ) : advocates.length === 0 ? (
            <Text style={styles.cardText}>No advocates available.</Text>
          ) : (
            <FlatList
              data={advocates}
              keyExtractor={(item) => item.id}
              renderItem={renderItem}
              style={{ maxHeight: 260, width: "100%" }}
            />
          )}

          <View style={styles.modalButtons}>
            <TouchableOpacity style={styles.secondaryButton} onPress={onClose}>
              <Text style={styles.secondaryButtonText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.primaryButton}
              onPress={handleConfirm}
            >
              <Text style={styles.primaryButtonText}>Assign</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#F4F5F7",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  backText: {
    fontSize: 16,
    marginRight: 8,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "600",
  },
  content: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  card: {
    backgroundColor: "#FFFFFF",
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    shadowColor: "#000",
    shadowOpacity: 0.05,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: "600",
    marginBottom: 8,
  },
  cardText: {
    fontSize: 14,
    marginBottom: 4,
  },
  mono: {
    fontFamily: "Menlo",
  },
  bold: {
    fontWeight: "600",
  },
  primaryButton: {
    marginTop: 8,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#2563EB",
  },
  primaryButtonText: {
    color: "#FFFFFF",
    fontWeight: "600",
  },
  secondaryButton: {
    marginTop: 8,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#CBD5E1",
    backgroundColor: "#FFFFFF",
  },
  secondaryButtonText: {
    fontWeight: "500",
  },

  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(15, 23, 42, 0.5)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 20,
  },
  modalContent: {
    width: "100%",
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    padding: 16,
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: "600",
    marginBottom: 8,
  },
  modalButtons: {
    flexDirection: "row",
    justifyContent: "flex-end",
    marginTop: 12,
  },
  advocateRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 8,
  },
  advocateRowSelected: {
    backgroundColor: "#DBEAFE",
  },
  advocateName: {
    flex: 1,
    fontSize: 14,
  },
  advocateSelectedMark: {
    fontSize: 16,
    fontWeight: "700",
  },
});

export default PatientDetailScreen;
