// Policy overlay: fake multisig. Mirrors Plumb's -rejectfakemultisig
// (https://github.com/plumb-node/plumb). Policy, not consensus: it says which
// transactions a Plumb node would refuse to relay or mine, never which are valid.
export default {
  "@context": "../../context.jsonld",
  "@graph": [
    {
      "@id": "btc:policy-fake-multisig",
      "@type": "Module",
      "label": "policy-fake-multisig",
      "version": "0.0.1",
      "layer": "policy",
      "tier": "deterministic",
      "source": "https://github.com/plumb-node/plumb#-rejectfakemultisig",
      "comment": "A CHECKMULTISIG whose key list is mostly never proven by a signature is a data carrier wearing a multisig costume: a 1-of-15 pays for one signature and ships fourteen 33-byte blobs that are never checked. This overlay flags any executed multisig whose unproven keys (n minus m) exceed a threshold. Measured on BLAKE2b mainnet blocks 976646-976650: 9 hits, all the same 1-of-15 P2WSH loop, 53.7% of mined weight, 0 false positives in 836 transactions."
    },
    {
      "@id": "btc:FakeMultisigRules",
      "@type": "RuleSet",
      "module": "btc:policy-fake-multisig",
      "label": "FakeMultisigRules",
      "phase": "policy",
      "maxUnprovenKeys": 10,
      "comment": "Applied to every script an input actually executes: a bare scriptPubKey, a P2SH redeem script, or a P2WSH witness script. Tapscript is skipped because CHECKMULTISIG is disabled there by consensus (BIP 342). The threshold comes from Plumb; its code is the reference if the README and this number ever disagree.",
      "rules": [
        {
          "@id": "btc:rule-policy-fake-multisig",
          "@type": "ValidationRule",
          "label": "fake-multisig",
          "errorCode": "policy-fake-multisig",
          "comment": "For every OP_CHECKMULTISIG or OP_CHECKMULTISIGVERIFY with a literal m and n, the number of keys that no signature will ever prove, n - m, must not exceed maxUnprovenKeys. Ordinary wallets (2-of-3, 3-of-5, Lightning 2-of-2, Liquid's 11-of-15) leave at most a handful unproven; the data loop leaves 14.",
          "check": "forall executed CHECKMULTISIG(m, n): n - m <= maxUnprovenKeys"
        }
      ]
    }
  ]
};
