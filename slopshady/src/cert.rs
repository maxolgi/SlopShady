use std::path::Path;

pub fn generate_self_signed_cert(
    cert_path: &Path,
    key_path: &Path,
) -> Result<(), Box<dyn std::error::Error>> {
    use rcgen::{CertificateParams, DnType, Ia5String, KeyPair, SanType};
    use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};

    let mut params = CertificateParams::default();

    params.distinguished_name.push(DnType::CountryName, "US");
    params
        .distinguished_name
        .push(DnType::StateOrProvinceName, "Local");
    params
        .distinguished_name
        .push(DnType::LocalityName, "Local");
    params
        .distinguished_name
        .push(DnType::OrganizationName, "Local Development");
    params
        .distinguished_name
        .push(DnType::CommonName, "localhost");

    params.subject_alt_names = vec![
        SanType::DnsName(Ia5String::try_from("localhost")?),
        SanType::DnsName(Ia5String::try_from("*.localhost")?),
        SanType::IpAddress(IpAddr::V4(Ipv4Addr::new(127, 0, 0, 1))),
        SanType::IpAddress(IpAddr::V6(Ipv6Addr::LOCALHOST)),
    ];

    let key_pair = KeyPair::generate()?;
    let cert = params.self_signed(&key_pair)?;

    std::fs::write(cert_path, cert.pem())?;
    std::fs::write(key_path, key_pair.serialize_pem())?;

    Ok(())
}
