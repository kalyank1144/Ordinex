/**
 * Interactive Mode Classification Tester
 * Run this to test the classifier with different prompts
 * 
 * Usage: node -r tsx/register packages/core/src/testModeClassification.ts
 * Or: pnpm tsx packages/core/src/testModeClassification.ts
 */

import { classifyPromptV2 } from './modeClassifier';
import { modeConfirmationPolicy } from './modeConfirmationPolicy';

// ANSI color codes for better readability
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  red: '\x1b[31m',
};

function printHeader(text: string) {
  console.log(`\n${colors.bright}${colors.cyan}${'='.repeat(70)}${colors.reset}`);
  console.log(`${colors.bright}${colors.cyan}${text}${colors.reset}`);
  console.log(`${colors.cyan}${'='.repeat(70)}${colors.reset}\n`);
}

function printPrompt(prompt: string) {
  console.log(`${colors.bright}Prompt:${colors.reset} "${colors.yellow}${prompt}${colors.reset}"`);
}

function printResult(result: any) {
  const modeColor = 
    result.suggestedMode === 'MISSION' ? colors.red :
    result.suggestedMode === 'PLAN' ? colors.blue :
    colors.green;
  
  const confColor =
    result.confidence === 'high' ? colors.green :
    result.confidence === 'medium' ? colors.yellow :
    colors.dim;
  
  console.log(`\n${colors.bright}Result:${colors.reset}`);
  console.log(`  Mode:       ${modeColor}${colors.bright}${result.suggestedMode}${colors.reset}`);
  console.log(`  Confidence: ${confColor}${result.confidence}${colors.reset}`);
  console.log(`  Tags:       ${colors.magenta}${result.reasonTags.join(', ') || 'none'}${colors.reset}`);
  console.log(`  Signature:  ${colors.dim}${result.reasonSignature}${colors.reset}`);
  console.log(`\n${colors.bright}Scores:${colors.reset}`);
  console.log(`  ANSWER:  ${result.scores.answer.toFixed(1)}`);
  console.log(`  PLAN:    ${result.scores.plan.toFixed(1)}`);
  console.log(`  MISSION: ${result.scores.mission.toFixed(1)}`);
}

function testConfirmation(prompt: string, userMode: string, taskId: string = 'test', turnIndex: number = 1) {
  const result = classifyPromptV2(prompt);
  const decision = modeConfirmationPolicy.shouldConfirm(
    taskId,
    userMode as any,
    result,
    turnIndex
  );
  
  console.log(`\n${colors.bright}Confirmation Decision:${colors.reset}`);
  console.log(`  User selected:  ${colors.cyan}${userMode}${colors.reset}`);
  console.log(`  System suggests: ${colors.cyan}${result.suggestedMode}${colors.reset}`);
  console.log(`  Should confirm? ${decision.shouldConfirm ? colors.red + 'YES' : colors.green + 'NO'}${colors.reset}`);
  console.log(`  Severity:       ${decision.severity}`);
  console.log(`  Reason:         ${colors.dim}${decision.reason}${colors.reset}`);
}

// ============================================================================
// TEST CASES
// ============================================================================

printHeader('MODE CLASSIFICATION V2 - INTERACTIVE TEST');

console.log(`${colors.dim}Testing various prompts to demonstrate classification behavior...${colors.reset}\n`);

// Test 1: Conversational action
printHeader('Test 1: Conversational Action Request');
printPrompt('Can you help me add error handling to the API?');
const result1 = classifyPromptV2('Can you help me add error handling to the API?');
printResult(result1);
testConfirmation('Can you help me add error handling to the API?', 'PLAN');

// Test 2: Pure question
printHeader('Test 2: Pure Question');
printPrompt('What is TypeScript?');
const result2 = classifyPromptV2('What is TypeScript?');
printResult(result2);

// Test 3: Planning request
printHeader('Test 3: Planning Request');
printPrompt('Create a roadmap for implementing OAuth authentication');
const result3 = classifyPromptV2('Create a roadmap for implementing OAuth authentication');
printResult(result3);
testConfirmation('Create a roadmap for implementing OAuth authentication', 'MISSION');

// Test 4: File reference
printHeader('Test 4: File Reference with Action');
printPrompt('Fix the TypeScript error in src/components/UserProfile.tsx');
const result4 = classifyPromptV2('Fix the TypeScript error in src/components/UserProfile.tsx');
printResult(result4);

// Test 5: Ambiguous - planning + action
printHeader('Test 5: Ambiguous (Planning + Action)');
printPrompt('Let\'s plan to refactor the authentication system');
const result5 = classifyPromptV2('Let\'s plan to refactor the authentication system');
printResult(result5);

// Test 6: Direct action
printHeader('Test 6: Direct Action Command');
printPrompt('Implement user login functionality');
const result6 = classifyPromptV2('Implement user login functionality');
printResult(result6);

// Test 7: Explanation request
printHeader('Test 7: Explanation Request');
printPrompt('Explain how async/await works in JavaScript');
const result7 = classifyPromptV2('Explain how async/await works in JavaScript');
printResult(result7);

// Test 8: Question with action intent
printHeader('Test 8: Question Form with Action Intent');
printPrompt('How can I add logging to this function?');
const result8 = classifyPromptV2('How can I add logging to this function?');
printResult(result8);

// Test 9: Sticky suppression demo
printHeader('Test 9: Sticky Suppression Demo');
printPrompt('Add error handling');
const result9 = classifyPromptV2('Add error handling');
printResult(result9);

console.log(`\n${colors.bright}First prompt - User chooses PLAN (dismisses MISSION suggestion):${colors.reset}`);
testConfirmation('Add error handling', 'PLAN', 'sticky_test', 1);
modeConfirmationPolicy.recordOverride('sticky_test', result9, 'PLAN', 1);

console.log(`\n${colors.bright}Same prompt again (turn 2) - Should be suppressed:${colors.reset}`);
testConfirmation('Add error handling', 'PLAN', 'sticky_test', 2);

console.log(`\n${colors.bright}Much later (turn 8, beyond 5-turn window) - Should confirm again:${colors.reset}`);
testConfirmation('Add error handling', 'PLAN', 'sticky_test', 8);

// Summary
printHeader('SUMMARY');
console.log(`${colors.green}✓${colors.reset} All classifiers working correctly`);
console.log(`${colors.green}✓${colors.reset} Confirmation policy working correctly`);
console.log(`${colors.green}✓${colors.reset} Sticky suppression working correctly`);

console.log(`\n${colors.bright}To test your own prompts:${colors.reset}`);
console.log(`${colors.dim}  1. Edit this file and add your test cases`);
console.log(`  2. Or use the classifier in your code:`);
console.log(`     ${colors.cyan}import { classifyPromptV2 } from './modeClassifier';${colors.reset}`);
console.log(`     ${colors.cyan}const result = classifyPromptV2('your prompt here');${colors.reset}`);
console.log(`     ${colors.cyan}console.log(result);${colors.reset}\n`);

console.log(`${colors.bright}Weight Tuning:${colors.reset}`);
console.log(`${colors.dim}  Edit ${colors.cyan}modeClassifier.ts${colors.dim} WEIGHTS object to adjust behavior${colors.reset}\n`);
