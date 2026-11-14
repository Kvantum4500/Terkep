from terkep_pipeline.normalize import core_tokens, fold, is_generic, name_similarity, settlement_adjectives


def test_fold_removes_accents_and_punctuation():
    assert fold("Szent György-hegy") == "szent gyorgy hegy"
    assert fold("Őrség – Ű") == "orseg u"


def test_generic_names():
    assert is_generic("Római katolikus templom")
    assert is_generic("Református templom")
    assert not is_generic("Szent Anna-templom")
    # a „kő” sosem generikus
    assert not is_generic("Kő")


def test_settlement_adjectives():
    assert "visegradi" in settlement_adjectives("Visegrád")
    assert "egri" in settlement_adjectives("Eger")
    assert "pannonhalmi" in settlement_adjectives("Pannonhalma")


def test_core_tokens_strip_settlement_adjective():
    assert core_tokens("Visegrádi fellegvár", "Visegrád") == []
    assert core_tokens("Salgó vára") == ["salgo"]


def test_similarity_strong_for_variants():
    assert name_similarity("Egri vár", "Egri vár") == 1.0
    assert name_similarity("Szent György-hegy", "Szent György hegy") >= 0.95
    assert name_similarity("Boldogkő vára", "Boldogkői vár") >= 0.85


def test_similarity_low_for_different_places():
    assert name_similarity("Füzéri vár", "Regéci vár") < 0.6
    assert name_similarity("Kékes", "Galya-tető") < 0.6


def test_token_set_not_used_for_single_tokens():
    # a token_set_ratio részhalmazra 100-at adna („egri” ⊂ „egri minorita”)
    assert name_similarity("Egri templom", "Egri minorita templom") < 0.85
