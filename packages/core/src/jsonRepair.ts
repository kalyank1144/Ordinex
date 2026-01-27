/**
 * JSON Repair Utility
 * 
 * LLMs often return malformed JSON with common issues:
 * - Trailing commas: {"key": "value",}
 * - Single quotes: {'key': 'value'}
 * - Unquoted property names: {key: "value"}
 * - JavaScript comments: {"key": "value" // comment }
 * - Control characters in strings
 * - Unterminated strings
 * - Nested objects with complex structures
 * 
 * This module provides robust JSON repair functions to handle these cases.
 * 
 * V2: Improved handling for complex nested structures in mission breakdown flow
 */

export interface JsonRepairResult {
  success: boolean;
  data?: any;
  error?: string;
  repairs?: string[];  // List of repairs applied
}

/**
 * Attempt to parse JSON with automatic repair of common LLM mistakes
 */
export function safeJsonParse(input: string): JsonRepairResult {
  const repairs: string[] = [];
  let jsonStr = input.trim();

  // STEP 0: Log input info for debugging
  console.log('[jsonRepair] Input length:', jsonStr.length);
  console.log('[jsonRepair] First 100 chars:', jsonStr.substring(0, 100).replace(/\n/g, '\\n'));
  console.log('[jsonRepair] Last 100 chars:', jsonStr.substring(Math.max(0, jsonStr.length - 100)).replace(/\n/g, '\\n'));

  // Step 1: Extract JSON from markdown code blocks
  const jsonBlockMatch = jsonStr.match(/```json\s*([\s\S]*?)\s*```/);
  if (jsonBlockMatch) {
    jsonStr = jsonBlockMatch[1].trim();
    repairs.push('Extracted from JSON code block');
  } else {
    const codeBlockMatch = jsonStr.match(/```\s*([\s\S]*?)\s*```/);
    if (codeBlockMatch) {
      jsonStr = codeBlockMatch[1].trim();
      repairs.push('Extracted from generic code block');
    }
  }

  // Step 1b: Strip leading non-JSON text (LLM often adds explanation before JSON)
  // Find the first { or [ in the string
  const firstBrace = jsonStr.indexOf('{');
  const firstBracket = jsonStr.indexOf('[');
  let jsonStartIdx = -1;
  
  if (firstBrace !== -1 && firstBracket !== -1) {
    jsonStartIdx = Math.min(firstBrace, firstBracket);
  } else if (firstBrace !== -1) {
    jsonStartIdx = firstBrace;
  } else if (firstBracket !== -1) {
    jsonStartIdx = firstBracket;
  }
  
  if (jsonStartIdx > 0) {
    const strippedText = jsonStr.substring(0, jsonStartIdx);
    // Only strip if it's clearly non-JSON text (not just whitespace)
    if (strippedText.trim().length > 0) {
      repairs.push(`Stripped ${jsonStartIdx} leading characters before JSON`);
      jsonStr = jsonStr.substring(jsonStartIdx);
      console.log('[jsonRepair] Stripped leading text:', strippedText.substring(0, 100).replace(/\n/g, '\\n'));
    }
  }

  // Step 2: Try to extract JSON object/array using balanced bracket matching
  const extracted = extractBalancedJson(jsonStr);
  if (extracted) {
    jsonStr = extracted;
    repairs.push('Extracted JSON with balanced bracket matching');
  } else {
    // Fallback to simple regex extraction
    const jsonMatch = jsonStr.match(/[\[{][\s\S]*[\]}]/);
    if (jsonMatch) {
      jsonStr = jsonMatch[0];
      repairs.push('Extracted JSON object/array (fallback)');
    }
  }

  // Step 3: Try parsing as-is first
  try {
    const data = JSON.parse(jsonStr);
    return { success: true, data, repairs };
  } catch (firstError) {
    // Continue with repairs
    repairs.push(`Initial parse failed: ${firstError instanceof Error ? firstError.message : String(firstError)}`);
  }

  // Step 4: Apply comprehensive repairs
  let repairedJson = jsonStr;

  // 4a: Remove JavaScript comments
  const beforeComments = repairedJson;
  repairedJson = removeJsComments(repairedJson);
  if (repairedJson !== beforeComments) {
    repairs.push('Removed JavaScript comments');
  }

  // 4b: Fix single quotes to double quotes (outside of string values)
  const beforeQuotes = repairedJson;
  repairedJson = fixSingleQuotes(repairedJson);
  if (repairedJson !== beforeQuotes) {
    repairs.push('Fixed single quotes to double quotes');
  }

  // 4c: Quote unquoted property names (IMPROVED for nested structures)
  const beforeUnquoted = repairedJson;
  repairedJson = quoteUnquotedKeysRobust(repairedJson);
  if (repairedJson !== beforeUnquoted) {
    repairs.push('Quoted unquoted property names (robust)');
  }

  // 4d: Fix trailing commas
  const beforeTrailing = repairedJson;
  repairedJson = removeTrailingCommas(repairedJson);
  if (repairedJson !== beforeTrailing) {
    repairs.push('Removed trailing commas');
  }

  // 4e: Sanitize control characters in strings
  const beforeControl = repairedJson;
  repairedJson = sanitizeControlCharacters(repairedJson);
  if (repairedJson !== beforeControl) {
    repairs.push('Sanitized control characters');
  }

  // 4f: Repair unterminated strings
  const beforeUnterminated = repairedJson;
  repairedJson = repairUnterminatedStrings(repairedJson);
  if (repairedJson !== beforeUnterminated) {
    repairs.push('Repaired unterminated strings');
  }

  // 4g: Fix missing commas between properties (NEW for "Expected ',' or '}'" errors)
  const beforeMissingCommas = repairedJson;
  repairedJson = fixMissingCommas(repairedJson);
  if (repairedJson !== beforeMissingCommas) {
    repairs.push('Fixed missing commas between properties');
  }

  // 4h: Escape unescaped quotes inside strings (NEW for embedded content)
  const beforeEscapeQuotes = repairedJson;
  repairedJson = escapeEmbeddedQuotes(repairedJson);
  if (repairedJson !== beforeEscapeQuotes) {
    repairs.push('Escaped embedded quotes in strings');
  }

  // Step 5: Try parsing again
  try {
    const data = JSON.parse(repairedJson);
    return { success: true, data, repairs };
  } catch (secondError) {
    repairs.push(`Parse after repairs failed: ${secondError instanceof Error ? secondError.message : String(secondError)}`);
  }

  // Step 6: Last resort - aggressive repair
  try {
    const aggressiveRepaired = aggressiveJsonRepair(jsonStr);
    const data = JSON.parse(aggressiveRepaired);
    repairs.push('Applied aggressive JSON repair');
    return { success: true, data, repairs };
  } catch (thirdError) {
    repairs.push(`Aggressive repair failed: ${thirdError instanceof Error ? thirdError.message : String(thirdError)}`);
  }

  // Step 7: Ultra-aggressive repair - multi-pass
  try {
    const ultraRepaired = ultraAggressiveJsonRepair(jsonStr);
    const data = JSON.parse(ultraRepaired);
    repairs.push('Applied ultra-aggressive JSON repair');
    return { success: true, data, repairs };
  } catch (finalError) {
    return {
      success: false,
      error: `Failed to parse JSON after all repairs: ${finalError instanceof Error ? finalError.message : String(finalError)}`,
      repairs,
    };
  }
}

/**
 * Extract JSON using balanced bracket matching
 * This is more reliable than greedy regex for nested structures
 */
function extractBalancedJson(input: string): string | null {
  // Find the first { or [
  let startIdx = -1;
  let startChar = '';
  
  for (let i = 0; i < input.length; i++) {
    if (input[i] === '{' || input[i] === '[') {
      startIdx = i;
      startChar = input[i];
      break;
    }
  }
  
  if (startIdx === -1) return null;
  
  const endChar = startChar === '{' ? '}' : ']';
  let depth = 0;
  let inString = false;
  let escapeNext = false;
  let endIdx = -1;
  
  for (let i = startIdx; i < input.length; i++) {
    const char = input[i];
    
    if (escapeNext) {
      escapeNext = false;
      continue;
    }
    
    if (char === '\\' && inString) {
      escapeNext = true;
      continue;
    }
    
    if (char === '"') {
      inString = !inString;
      continue;
    }
    
    if (!inString) {
      if (char === '{' || char === '[') {
        depth++;
      } else if (char === '}' || char === ']') {
        depth--;
        if (depth === 0) {
          endIdx = i;
          break;
        }
      }
    }
  }
  
  if (endIdx === -1) return null;
  
  return input.substring(startIdx, endIdx + 1);
}

/**
 * Remove JavaScript-style comments from JSON
 * Handles both line comments (double slash) and block comments
 */
function removeJsComments(jsonStr: string): string {
  let result = '';
  let inString = false;
  let escapeNext = false;
  let i = 0;

  while (i < jsonStr.length) {
    const char = jsonStr[i];
    const nextChar = jsonStr[i + 1];

    if (escapeNext) {
      result += char;
      escapeNext = false;
      i++;
      continue;
    }

    if (char === '\\' && inString) {
      result += char;
      escapeNext = true;
      i++;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      result += char;
      i++;
      continue;
    }

    if (!inString) {
      // Check for line comment
      if (char === '/' && nextChar === '/') {
        // Skip until end of line
        while (i < jsonStr.length && jsonStr[i] !== '\n') {
          i++;
        }
        continue;
      }

      // Check for block comment
      if (char === '/' && nextChar === '*') {
        i += 2; // Skip /*
        while (i < jsonStr.length - 1) {
          if (jsonStr[i] === '*' && jsonStr[i + 1] === '/') {
            i += 2; // Skip */
            break;
          }
          i++;
        }
        continue;
      }
    }

    result += char;
    i++;
  }

  return result;
}

/**
 * Fix single quotes to double quotes for JSON strings
 * Only converts quotes that appear to be JSON string delimiters
 */
function fixSingleQuotes(jsonStr: string): string {
  let result = '';
  let inDoubleString = false;
  let inSingleString = false;
  let escapeNext = false;

  for (let i = 0; i < jsonStr.length; i++) {
    const char = jsonStr[i];

    if (escapeNext) {
      result += char;
      escapeNext = false;
      continue;
    }

    if (char === '\\') {
      result += char;
      escapeNext = true;
      continue;
    }

    if (char === '"' && !inSingleString) {
      inDoubleString = !inDoubleString;
      result += char;
      continue;
    }

    if (char === "'" && !inDoubleString) {
      // Convert single quote to double quote
      inSingleString = !inSingleString;
      result += '"';
      continue;
    }

    result += char;
  }

  return result;
}

/**
 * Quote unquoted property names
 * Converts {key: "value"} to {"key": "value"}
 */
function quoteUnquotedKeys(jsonStr: string): string {
  // This regex matches unquoted keys followed by :
  // It's careful to not match things inside strings
  let result = '';
  let inString = false;
  let escapeNext = false;
  let i = 0;

  while (i < jsonStr.length) {
    const char = jsonStr[i];

    if (escapeNext) {
      result += char;
      escapeNext = false;
      i++;
      continue;
    }

    if (char === '\\' && inString) {
      result += char;
      escapeNext = true;
      i++;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      result += char;
      i++;
      continue;
    }

    if (!inString) {
      // Look for unquoted key pattern: identifier followed by :
      // Must be after { or , and optional whitespace
      if (/[a-zA-Z_$]/.test(char)) {
        // Check if this is an unquoted key
        let keyEnd = i;
        while (keyEnd < jsonStr.length && /[a-zA-Z0-9_$]/.test(jsonStr[keyEnd])) {
          keyEnd++;
        }
        
        // Skip whitespace after key
        let colonPos = keyEnd;
        while (colonPos < jsonStr.length && /\s/.test(jsonStr[colonPos])) {
          colonPos++;
        }
        
        // Check if followed by colon (indicating it's a key)
        if (jsonStr[colonPos] === ':') {
          const key = jsonStr.substring(i, keyEnd);
          
          // Check if it's a keyword that should remain unquoted (true, false, null)
          if (key !== 'true' && key !== 'false' && key !== 'null') {
            // Check what's before this - should be { or , or start of line
            let beforeKey = i - 1;
            while (beforeKey >= 0 && /\s/.test(jsonStr[beforeKey])) {
              beforeKey--;
            }
            
            if (beforeKey < 0 || jsonStr[beforeKey] === '{' || jsonStr[beforeKey] === ',') {
              result += '"' + key + '"';
              i = keyEnd;
              continue;
            }
          }
        }
      }
    }

    result += char;
    i++;
  }

  return result;
}

/**
 * Remove trailing commas before ] or }
 */
function removeTrailingCommas(jsonStr: string): string {
  let result = '';
  let inString = false;
  let escapeNext = false;

  for (let i = 0; i < jsonStr.length; i++) {
    const char = jsonStr[i];

    if (escapeNext) {
      result += char;
      escapeNext = false;
      continue;
    }

    if (char === '\\' && inString) {
      result += char;
      escapeNext = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      result += char;
      continue;
    }

    if (!inString && char === ',') {
      // Look ahead for ] or } (skipping whitespace)
      let j = i + 1;
      while (j < jsonStr.length && /\s/.test(jsonStr[j])) {
        j++;
      }
      
      if (jsonStr[j] === ']' || jsonStr[j] === '}') {
        // Skip this comma (trailing comma)
        continue;
      }
    }

    result += char;
  }

  return result;
}

/**
 * Sanitize control characters inside JSON strings
 */
function sanitizeControlCharacters(jsonStr: string): string {
  let result = '';
  let inString = false;
  let escapeNext = false;

  for (let i = 0; i < jsonStr.length; i++) {
    const char = jsonStr[i];
    const charCode = char.charCodeAt(0);

    if (escapeNext) {
      result += char;
      escapeNext = false;
      continue;
    }

    if (char === '\\') {
      result += char;
      escapeNext = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      result += char;
      continue;
    }

    if (inString && charCode < 32) {
      // Control character inside string - escape it
      switch (charCode) {
        case 9:  result += '\\t'; break;
        case 10: result += '\\n'; break;
        case 13: result += '\\r'; break;
        case 8:  result += '\\b'; break;
        case 12: result += '\\f'; break;
        default: result += '\\u' + charCode.toString(16).padStart(4, '0');
      }
      continue;
    }

    result += char;
  }

  return result;
}

/**
 * Repair unterminated strings
 */
function repairUnterminatedStrings(jsonStr: string): string {
  // Count quotes
  let quoteCount = 0;
  let escapeNext = false;

  for (const char of jsonStr) {
    if (escapeNext) {
      escapeNext = false;
      continue;
    }
    if (char === '\\') {
      escapeNext = true;
      continue;
    }
    if (char === '"') {
      quoteCount++;
    }
  }

  if (quoteCount % 2 === 0) {
    return jsonStr; // Balanced
  }

  // Unbalanced - try to close unclosed strings
  let result = '';
  let inString = false;
  escapeNext = false;

  for (let i = 0; i < jsonStr.length; i++) {
    const char = jsonStr[i];

    if (escapeNext) {
      result += char;
      escapeNext = false;
      continue;
    }

    if (char === '\\') {
      result += char;
      escapeNext = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      result += char;
      continue;
    }

    // If inside string but hit structural char, close string first
    if (inString && (char === '}' || char === ']' || char === ',')) {
      result += '"' + char;
      inString = false;
      continue;
    }

    result += char;
  }

  // Close string at end if needed
  if (inString) {
    result += '"';
  }

  return result;
}

/**
 * Fix missing commas between JSON properties
 * Handles cases like: {"key1": "value1" "key2": "value2"}
 * which should be: {"key1": "value1", "key2": "value2"}
 */
function fixMissingCommas(jsonStr: string): string {
  let result = '';
  let inString = false;
  let escapeNext = false;
  let lastNonWhitespace = '';
  let pendingWhitespace = '';

  for (let i = 0; i < jsonStr.length; i++) {
    const char = jsonStr[i];

    if (escapeNext) {
      result += pendingWhitespace + char;
      pendingWhitespace = '';
      escapeNext = false;
      lastNonWhitespace = char;
      continue;
    }

    if (char === '\\' && inString) {
      result += pendingWhitespace + char;
      pendingWhitespace = '';
      escapeNext = true;
      lastNonWhitespace = char;
      continue;
    }

    if (char === '"') {
      // Check if we need to insert a comma
      // If last non-whitespace was " or a value terminator, and this is a new string start
      if (!inString && (lastNonWhitespace === '"' || lastNonWhitespace === '}' || lastNonWhitespace === ']' || /\d/.test(lastNonWhitespace))) {
        // Look ahead to see if this is a key (followed by :)
        let lookAhead = i + 1;
        while (lookAhead < jsonStr.length && jsonStr[lookAhead] !== '"') {
          lookAhead++;
        }
        lookAhead++; // Skip closing quote
        while (lookAhead < jsonStr.length && /\s/.test(jsonStr[lookAhead])) {
          lookAhead++;
        }
        // If followed by colon, this is a key - need comma before it
        if (jsonStr[lookAhead] === ':') {
          result += ',' + pendingWhitespace + char;
          pendingWhitespace = '';
          inString = !inString;
          lastNonWhitespace = char;
          continue;
        }
      }
      
      result += pendingWhitespace + char;
      pendingWhitespace = '';
      inString = !inString;
      lastNonWhitespace = char;
      continue;
    }

    // Track whitespace separately
    if (/\s/.test(char)) {
      pendingWhitespace += char;
      continue;
    }

    result += pendingWhitespace + char;
    pendingWhitespace = '';
    lastNonWhitespace = char;
  }

  // Don't forget trailing whitespace
  result += pendingWhitespace;

  return result;
}

/**
 * Escape unescaped quotes inside JSON strings
 * This handles cases where the LLM puts code content with quotes inside JSON strings
 */
function escapeEmbeddedQuotes(jsonStr: string): string {
  // This is a heuristic-based repair for embedded quotes in string values
  // It looks for patterns like: "key": "value with "embedded" quotes"
  // and tries to escape the embedded quotes
  
  let result = '';
  let inString = false;
  let escapeNext = false;
  let stringStart = -1;
  let colonSeen = false;

  for (let i = 0; i < jsonStr.length; i++) {
    const char = jsonStr[i];

    if (escapeNext) {
      result += char;
      escapeNext = false;
      continue;
    }

    if (char === '\\') {
      result += char;
      escapeNext = true;
      continue;
    }

    if (char === '"') {
      if (!inString) {
        // Starting a string
        inString = true;
        stringStart = i;
        colonSeen = false;
        result += char;
        continue;
      }
      
      // We're inside a string and hit a quote
      // Check if this is a legitimate end of string
      let j = i + 1;
      while (j < jsonStr.length && /\s/.test(jsonStr[j])) {
        j++;
      }
      
      const nextSignificantChar = jsonStr[j];
      
      // If next significant char is structural JSON, this is end of string
      if (nextSignificantChar === ',' || nextSignificantChar === '}' || 
          nextSignificantChar === ']' || nextSignificantChar === ':' ||
          j >= jsonStr.length) {
        inString = false;
        result += char;
        continue;
      }
      
      // Otherwise, this might be an embedded quote - escape it
      // But only if we're in a value (after colon), not a key
      if (colonSeen) {
        result += '\\' + char;
        continue;
      }
      
      // For keys, just end the string normally
      inString = false;
      result += char;
      continue;
    }

    if (char === ':' && !inString) {
      colonSeen = true;
    }

    if ((char === ',' || char === '}' || char === ']') && !inString) {
      colonSeen = false;
    }

    result += char;
  }

  return result;
}

/**
 * ROBUST unquoted key quoting - handles nested structures properly
 * This is a multi-pass approach that handles deeply nested objects
 */
function quoteUnquotedKeysRobust(jsonStr: string): string {
  // Multi-pass approach: apply simple key quoting multiple times
  // This handles nested structures better than single-pass
  let result = jsonStr;
  let prevResult = '';
  let passes = 0;
  const MAX_PASSES = 10;

  while (result !== prevResult && passes < MAX_PASSES) {
    prevResult = result;
    passes++;

    // State-machine based key quoting
    let output = '';
    let inString = false;
    let escapeNext = false;
    let i = 0;

    while (i < result.length) {
      const char = result[i];

      if (escapeNext) {
        output += char;
        escapeNext = false;
        i++;
        continue;
      }

      if (char === '\\' && inString) {
        output += char;
        escapeNext = true;
        i++;
        continue;
      }

      if (char === '"') {
        inString = !inString;
        output += char;
        i++;
        continue;
      }

      if (!inString) {
        // After { or , check for unquoted key
        if (char === '{' || char === ',') {
          output += char;
          i++;

          // Skip whitespace
          while (i < result.length && /\s/.test(result[i])) {
            output += result[i];
            i++;
          }

          // Check for unquoted identifier followed by :
          if (i < result.length && /[a-zA-Z_$]/.test(result[i])) {
            let keyStart = i;
            let keyEnd = i;
            
            // Collect identifier chars (including hyphens for keys like "max-width")
            while (keyEnd < result.length && /[a-zA-Z0-9_$-]/.test(result[keyEnd])) {
              keyEnd++;
            }
            
            // Skip whitespace after key
            let colonPos = keyEnd;
            while (colonPos < result.length && /\s/.test(result[colonPos])) {
              colonPos++;
            }
            
            // Check if followed by colon
            if (result[colonPos] === ':') {
              const key = result.substring(keyStart, keyEnd);
              
              // Don't quote true, false, null (these are values, not keys)
              if (key !== 'true' && key !== 'false' && key !== 'null') {
                output += '"' + key + '"';
                i = keyEnd;
                continue;
              }
            }
          }
          continue;
        }
      }

      output += char;
      i++;
    }

    result = output;
  }

  return result;
}

/**
 * Aggressive JSON repair - last resort
 * Uses regex-based replacements that may be less precise
 */
function aggressiveJsonRepair(jsonStr: string): string {
  let repaired = jsonStr;

  // Remove all comments (more aggressive)
  repaired = repaired.replace(/\/\/[^\n]*/g, '');
  repaired = repaired.replace(/\/\*[\s\S]*?\*\//g, '');

  // Fix common issues with regex
  // Trailing commas before } or ]
  repaired = repaired.replace(/,\s*([\]}])/g, '$1');

  // Unquoted keys (simple pattern - IMPROVED to handle hyphens and underscores)
  repaired = repaired.replace(/([{,]\s*)([a-zA-Z_$][a-zA-Z0-9_$-]*)\s*:/g, '$1"$2":');

  // Single quotes to double quotes (simple - may have false positives)
  // Only do this if there are no double quotes at all
  if (!repaired.includes('"')) {
    repaired = repaired.replace(/'/g, '"');
  }

  // Fix escaped single quotes that became double quotes
  repaired = repaired.replace(/\\"/g, '\\"');

  // Remove BOM if present
  repaired = repaired.replace(/^\uFEFF/, '');

  // Trim whitespace
  repaired = repaired.trim();

  return repaired;
}

/**
 * Ultra-aggressive JSON repair - last resort after aggressive repair fails
 * Applies all repairs in multiple passes
 */
function ultraAggressiveJsonRepair(jsonStr: string): string {
  let repaired = jsonStr;

  // Step 1: Extract JSON with balanced brackets
  const extracted = extractBalancedJson(repaired);
  if (extracted) {
    repaired = extracted;
  }

  // Step 2: Remove all content before first { or [
  const startIdx = Math.min(
    repaired.indexOf('{') === -1 ? Infinity : repaired.indexOf('{'),
    repaired.indexOf('[') === -1 ? Infinity : repaired.indexOf('[')
  );
  if (startIdx !== Infinity && startIdx > 0) {
    repaired = repaired.substring(startIdx);
  }

  // Step 3: Remove all content after last matching } or ]
  let depth = 0;
  let lastValidEnd = -1;
  let inString = false;
  let escapeNext = false;

  for (let i = 0; i < repaired.length; i++) {
    const char = repaired[i];

    if (escapeNext) {
      escapeNext = false;
      continue;
    }

    if (char === '\\' && inString) {
      escapeNext = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (!inString) {
      if (char === '{' || char === '[') {
        depth++;
      } else if (char === '}' || char === ']') {
        depth--;
        if (depth === 0) {
          lastValidEnd = i;
        }
      }
    }
  }

  if (lastValidEnd > 0) {
    repaired = repaired.substring(0, lastValidEnd + 1);
  }

  // Step 4: Apply all repairs in sequence
  // 4a: Remove comments
  repaired = repaired.replace(/\/\/[^\n]*/g, '');
  repaired = repaired.replace(/\/\*[\s\S]*?\*\//g, '');

  // 4b: Fix trailing commas (multiple passes)
  for (let pass = 0; pass < 5; pass++) {
    repaired = repaired.replace(/,(\s*[\]}])/g, '$1');
  }

  // 4c: Quote ALL unquoted keys (very aggressive regex)
  // Matches word characters followed by colon, not inside quotes
  repaired = repaired.replace(/([{,]\s*)([a-zA-Z_$][a-zA-Z0-9_$-]*)\s*:/g, '$1"$2":');
  repaired = repaired.replace(/([{,]\s*)([a-zA-Z_$][a-zA-Z0-9_$-]*)\s*:/g, '$1"$2":'); // Second pass

  // 4d: Fix double quotes that got broken
  repaired = repaired.replace(/""([^"]+)""/g, '"$1"');

  // 4e: Fix missing commas between elements (heuristic)
  // After "value" followed by whitespace and "key":
  repaired = repaired.replace(/(")\s*\n\s*(")/g, '$1,\n$2');
  repaired = repaired.replace(/(")\s+(")/g, '$1, $2');

  // 4f: Fix null values that got corrupted
  repaired = repaired.replace(/:\s*undefined/g, ': null');
  repaired = repaired.replace(/:\s*NaN/g, ': null');

  // 4g: Sanitize control characters
  repaired = sanitizeControlCharacters(repaired);

  // 4h: Fix unterminated strings
  repaired = repairUnterminatedStrings(repaired);

  return repaired.trim();
}

/**
 * Parse JSON with detailed error information
 */
export function parseJsonWithContext(
  input: string,
  contextName: string = 'JSON'
): { data: any } | { error: string; context: string; repairs: string[] } {
  const result = safeJsonParse(input);

  if (result.success && result.data !== undefined) {
    return { data: result.data };
  }

  // Provide context around the error
  const preview = input.length > 200 ? input.substring(0, 200) + '...' : input;

  return {
    error: result.error || 'Unknown parse error',
    context: `Failed to parse ${contextName}. Input preview: ${preview}`,
    repairs: result.repairs || [],
  };
}
