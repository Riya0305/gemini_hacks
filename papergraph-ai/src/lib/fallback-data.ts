// Hardcoded demo graph used when the backend is unavailable.
import { GraphData } from "./types";

// Default Edge AI/TinyML graph shown in offline or fallback scenarios.
export const FALLBACK_GRAPH: GraphData = {
  // Demo nodes for the fallback graph.
  nodes: [
    { id: "Edge AI", type: "technology" },
    { id: "TinyML", type: "technology" },
    { id: "Neural Architecture Search", type: "method" },
    { id: "Knowledge Distillation", type: "method" },
    { id: "Glucose Monitoring", type: "application" },
    { id: "Predictive Maintenance", type: "application" },
    { id: "Federated Learning", type: "concept" },
    { id: "Model Compression", type: "concept" },
    { id: "Dr. Sarah Chen", type: "author" },
    { id: "Embedded Systems Lab", type: "author" },
  ],
  // Demo relationships connecting the fallback nodes.
  edges: [
    {
      source: "Edge AI",
      target: "Glucose Monitoring",
      relation: "enables",
      explanation:
        "Edge AI enables real-time glucose monitoring by running optimized neural networks directly on wearable hardware, eliminating cloud latency.",
      evidence:
        '"The optimized model achieves accurate glucose predictions directly on embedded hardware with sub-100ms inference time."',
    },
    {
      source: "TinyML",
      target: "Edge AI",
      relation: "powers",
      explanation:
        "TinyML provides the foundational framework for deploying machine learning models on microcontrollers that Edge AI systems rely on.",
      evidence:
        '"TinyML frameworks reduce model footprint to under 256KB while maintaining 94% accuracy on target tasks."',
    },
    {
      source: "Neural Architecture Search",
      target: "Model Compression",
      relation: "optimizes",
      explanation:
        "NAS automatically discovers compact network architectures that achieve high accuracy with fewer parameters, directly feeding model compression pipelines.",
      evidence:
        '"Our NAS-derived architectures achieve 3.2x compression with less than 1% accuracy degradation."',
    },
    {
      source: "Knowledge Distillation",
      target: "TinyML",
      relation: "enables",
      explanation:
        "Knowledge distillation transfers learned representations from large teacher models into tiny student models suitable for TinyML deployment.",
      evidence:
        '"The distilled student model retains 97% of the teacher\'s performance at 1/10th the parameter count."',
    },
    {
      source: "Federated Learning",
      target: "Edge AI",
      relation: "enhances",
      explanation:
        "Federated learning allows Edge AI devices to collaboratively improve models without sharing raw data, preserving privacy.",
      evidence:
        '"Federated training across 50 edge nodes improved global model accuracy by 12% without centralizing patient data."',
    },
    {
      source: "Dr. Sarah Chen",
      target: "Neural Architecture Search",
      relation: "developed",
      explanation:
        "Dr. Chen's lab pioneered the hardware-aware NAS approach that co-optimizes accuracy and latency for edge deployment.",
      evidence:
        '"Chen et al. introduced HW-NAS, jointly optimizing for accuracy and on-device inference latency."',
    },
    {
      source: "Embedded Systems Lab",
      target: "Predictive Maintenance",
      relation: "researches",
      explanation:
        "The Embedded Systems Lab focuses on deploying vibration analysis models on industrial IoT sensors for real-time fault detection.",
      evidence:
        '"Our lab deployed lightweight anomaly detection on ARM Cortex-M4 processors for continuous motor health monitoring."',
    },
    {
      source: "Model Compression",
      target: "TinyML",
      relation: "enables",
      explanation:
        "Model compression techniques like pruning and quantization make standard neural networks small enough to run within TinyML constraints.",
      evidence:
        '"Post-training quantization reduced the model from 4MB to 180KB with minimal accuracy loss."',
    },
    {
      source: "Edge AI",
      target: "Predictive Maintenance",
      relation: "enables",
      explanation:
        "Edge AI processes sensor streams locally on factory equipment, enabling sub-second fault detection without network dependency.",
      evidence:
        '"On-device inference detects bearing faults within 200ms of onset, compared to 2-5 seconds via cloud processing."',
    },
    {
      source: "Federated Learning",
      target: "Glucose Monitoring",
      relation: "improves",
      explanation:
        "Federated learning improves glucose prediction models by training across diverse patient populations without sharing medical records.",
      evidence:
        '"Cross-hospital federated training improved glucose prediction RMSE by 18% across all demographic groups."',
    },
  ],
};
